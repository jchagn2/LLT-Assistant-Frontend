/**
 * Git Diff Analyzer
 * Analyzes differences between two Git commits
 */

import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';
import { CodeChange, ChangeSummary, CodeDiff } from '../models/types';

/**
 * Git Diff Analyzer
 * Extracts and analyzes code changes between commits
 */
export class GitDiffAnalyzer {
	private workspaceRoot: string;

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	/**
	 * Analyze differences between two commits
	 * @param previousCommitHash Previous commit hash (or null for first commit)
	 * @param currentCommitHash Current commit hash
	 * @returns Map of file paths to code changes
	 */
	async analyzeCommitDiff(
		previousCommitHash: string | null,
		currentCommitHash: string
	): Promise<Map<string, CodeChange>> {
		const changes = new Map<string, CodeChange>();

		try {
			// Get list of changed Python files
			const changedFiles = this.getChangedFiles(previousCommitHash, currentCommitHash);

			// Process each changed file
			for (const filePath of changedFiles) {
				try {
					const change = await this.analyzeFileChange(
						filePath,
						previousCommitHash,
						currentCommitHash
					);

					if (change) {
						changes.set(filePath, change);
					}
				} catch (error) {
					console.error(`[Maintenance] Error analyzing file ${filePath}:`, error);
					// Continue with other files
				}
			}

			return changes;
		} catch (error) {
			console.error('[Maintenance] Error analyzing commit diff:', error);
			throw error;
		}
	}

	/**
	 * Analyze changes for a single file
	 */
	private async analyzeFileChange(
		filePath: string,
		previousCommitHash: string | null,
		currentCommitHash: string
	): Promise<CodeChange | null> {
		try {
			// Get old content
			const oldContent = previousCommitHash
				? this.getFileContentAtCommit(filePath, previousCommitHash)
				: '';

			// Get new content
			const newContent = this.getFileContentAtCommit(filePath, currentCommitHash);

			// Extract changed functions
			const changedFunctions = await this.extractChangedFunctions(
				oldContent,
				newContent,
				filePath
			);

			// Calculate line changes
			const { linesAdded, linesRemoved } = this.calculateLineChanges(oldContent, newContent);

			return {
				file_path: filePath,
				old_content: oldContent,
				new_content: newContent,
				changed_functions: changedFunctions,
				lines_added: linesAdded,
				lines_removed: linesRemoved
			};
		} catch (error) {
			console.error(`[Maintenance] Error analyzing file change for ${filePath}:`, error);
			return null;
		}
	}

	/**
	 * Get unified diff for a file
	 */
	getUnifiedDiff(
		filePath: string,
		previousCommitHash: string | null,
		currentCommitHash: string
	): string {
		try {
			if (!previousCommitHash) {
				// New file - show all content as additions
				const content = this.getFileContentAtCommit(filePath, currentCommitHash);
				return this.formatNewFileDiff(filePath, content);
			}

			const diff = execSync(
				`git diff ${previousCommitHash} ${currentCommitHash} -- ${filePath}`,
				{
					cwd: this.workspaceRoot,
					encoding: 'utf-8'
				}
			);

			return diff;
		} catch (error) {
			console.error(`[Maintenance] Error getting unified diff for ${filePath}:`, error);
			return '';
		}
	}

	/**
	 * Format diff for a new file
	 */
	private formatNewFileDiff(filePath: string, content: string): string {
		const lines = content.split('\n');
		let diff = `diff --git a/${filePath} b/${filePath}\n`;
		diff += `new file mode 100644\n`;
		diff += `index 0000000..1111111\n`;
		diff += `--- /dev/null\n`;
		diff += `+++ b/${filePath}\n`;
		diff += `@@ -0,0 +1,${lines.length} @@\n`;

		for (const line of lines) {
			diff += `+${line}\n`;
		}

		return diff;
	}

	/**
	 * Get code diff with unified diff
	 */
	async getCodeDiff(
		filePath: string,
		previousCommitHash: string | null,
		currentCommitHash: string
	): Promise<CodeDiff | null> {
		try {
			const change = await this.analyzeFileChange(
				filePath,
				previousCommitHash,
				currentCommitHash
			);

			if (!change) {
				return null;
			}

			const unifiedDiff = this.getUnifiedDiff(filePath, previousCommitHash, currentCommitHash);

			return {
				file_path: filePath,
				old_content: change.old_content,
				new_content: change.new_content,
				unified_diff: unifiedDiff,
				changed_functions: change.changed_functions,
				lines_added: change.lines_added,
				lines_removed: change.lines_removed
			};
		} catch (error) {
			console.error(`[Maintenance] Error getting code diff for ${filePath}:`, error);
			return null;
		}
	}

	/**
	 * Generate change summary from code changes
	 */
	generateChangeSummary(changes: Map<string, CodeChange>): ChangeSummary {
		let totalLinesAdded = 0;
		let totalLinesRemoved = 0;
		const allChangedFunctions: string[] = [];

		for (const change of changes.values()) {
			totalLinesAdded += change.lines_added;
			totalLinesRemoved += change.lines_removed;
			allChangedFunctions.push(...change.changed_functions);
		}

		// Determine change type
		const changeType = this.determineChangeType(totalLinesAdded, totalLinesRemoved);

		return {
			files_changed: changes.size,
			functions_changed: [...new Set(allChangedFunctions)], // Remove duplicates
			lines_added: totalLinesAdded,
			lines_removed: totalLinesRemoved,
			change_type: changeType
		};
	}

	/**
	 * Determine change type based on line changes
	 */
	private determineChangeType(
		linesAdded: number,
		linesRemoved: number
	): 'refactor' | 'feature_addition' | 'bug_fix' | 'breaking_change' {
		const totalChanges = linesAdded + linesRemoved;

		if (totalChanges > 100) {
			return 'feature_addition';
		} else if (linesRemoved > linesAdded * 2) {
			return 'refactor';
		} else if (linesAdded > linesRemoved * 2) {
			return 'feature_addition';
		} else if (linesRemoved > 0 && linesAdded === 0) {
			return 'breaking_change';
		} else {
			return 'bug_fix';
		}
	}

	/**
	 * Get list of changed files between two commits
	 */
	private getChangedFiles(
		previousCommitHash: string | null,
		currentCommitHash: string
	): string[] {
		try {
			let command: string;

			if (!previousCommitHash) {
				// First commit - show all files
				command = `git show --name-only --pretty=format: ${currentCommitHash}`;
			} else {
				command = `git diff --name-only ${previousCommitHash} ${currentCommitHash}`;
			}

			const output = execSync(command, {
				cwd: this.workspaceRoot,
				encoding: 'utf-8'
			});

			return output
				.split('\n')
				.map(line => line.trim())
				.filter(line => line.length > 0 && line.endsWith('.py') && !line.includes('test_'));
		} catch (error) {
			console.error('[Maintenance] Error getting changed files:', error);
			return [];
		}
	}

	/**
	 * Get file content at a specific commit
	 */
	private getFileContentAtCommit(filePath: string, commitHash: string): string {
		try {
			const content = execSync(`git show ${commitHash}:${filePath}`, {
				cwd: this.workspaceRoot,
				encoding: 'utf-8'
			});

			return content;
		} catch (error) {
			// File doesn't exist at this commit
			return '';
		}
	}

	/**
	 * Extract changed functions from old and new code
	 */
	private async extractChangedFunctions(
		oldCode: string,
		newCode: string,
		filePath: string
	): Promise<string[]> {
		try {
			const changed: string[] = [];

			// If old code is empty, all functions are new
			if (!oldCode || oldCode.trim() === '') {
				const newFunctions = await this.extractAllFunctions(newCode);
				return newFunctions;
			}

			// Analyze both versions
			const oldFunctions = await this.extractAllFunctions(oldCode);
			const newFunctions = await this.extractAllFunctions(newCode);

			// Find new or modified functions
			for (const newFunc of newFunctions) {
				if (!oldFunctions.includes(newFunc)) {
					// New function
					changed.push(newFunc);
				} else {
					// Check if implementation changed
					const isChanged = this.isFunctionModified(oldCode, newCode, newFunc);
					if (isChanged) {
						changed.push(newFunc);
					}
				}
			}

			return changed;
		} catch (error) {
			console.error('[Maintenance] Error extracting changed functions:', error);
			return [];
		}
	}

	/**
	 * Extract all function names from code
	 */
	private async extractAllFunctions(code: string): Promise<string[]> {
		try {
			const functions: string[] = [];

			// Simple regex-based extraction
			// Match: def function_name(
			const functionRegex = /^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm;
			let match;

			while ((match = functionRegex.exec(code)) !== null) {
				functions.push(match[1]);
			}

			return functions;
		} catch (error) {
			console.error('[Maintenance] Error extracting functions:', error);
			return [];
		}
	}

	/**
	 * Check if a function's implementation has changed
	 */
	private isFunctionModified(
		oldCode: string,
		newCode: string,
		functionName: string
	): boolean {
		try {
			const oldFuncCode = this.extractFunctionCode(oldCode, functionName);
			const newFuncCode = this.extractFunctionCode(newCode, functionName);

			return oldFuncCode !== newFuncCode;
		} catch (error) {
			console.error(`[Maintenance] Error checking if function ${functionName} modified:`, error);
			return false;
		}
	}

	/**
	 * Extract a specific function's code
	 */
	private extractFunctionCode(code: string, functionName: string): string {
		const lines = code.split('\n');
		let inFunction = false;
		let functionCode = '';
		let baseIndent = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Check if this is the function definition
			if (line.match(new RegExp(`^\\s*def\\s+${functionName}\\s*\\(`))) {
				inFunction = true;
				baseIndent = line.search(/\S/);
				functionCode += line + '\n';
				continue;
			}

			// If we're in the function, collect lines
			if (inFunction) {
				const currentIndent = line.search(/\S/);

				// Empty line or line with content at deeper indentation
				if (line.trim() === '' || currentIndent > baseIndent) {
					functionCode += line + '\n';
				} else {
					// Function ended
					break;
				}
			}
		}

		return functionCode;
	}

	/**
	 * Calculate line additions and deletions
	 */
	private calculateLineChanges(oldContent: string, newContent: string): {
		linesAdded: number;
		linesRemoved: number;
	} {
		const oldLines = oldContent.split('\n').filter(line => line.trim() !== '');
		const newLines = newContent.split('\n').filter(line => line.trim() !== '');

		// Simple heuristic: compare line counts
		const linesAdded = Math.max(0, newLines.length - oldLines.length);
		const linesRemoved = Math.max(0, oldLines.length - newLines.length);

		return { linesAdded, linesRemoved };
	}
}

