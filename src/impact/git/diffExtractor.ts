/**
 * Git Diff Extractor
 * Extracts code changes from git working directory vs HEAD
 */

import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';
import { CodeChange } from '../models/types';

/**
 * Git Diff Extractor class
 */
export class GitDiffExtractor {
	private workspaceRoot: string;

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	/**
	 * Get all Python file changes in working directory vs HEAD
	 */
	async getWorkingDirChanges(): Promise<Map<string, CodeChange>> {
		const diffMap = new Map<string, CodeChange>();

		try {
			// Check if we're in a git repository
			if (!this.isGitRepository()) {
				throw new Error('Not a git repository');
			}

			// Get list of changed Python files
			const changedFiles = this.getChangedPythonFiles();

			// Process each changed file
			for (const file of changedFiles) {
				try {
					const absolutePath = path.join(this.workspaceRoot, file);

					// Get old content from HEAD
					const oldContent = this.getFileContentFromHead(file);

					// Get current content from working directory
					const newContent = await this.getCurrentFileContent(absolutePath);

					// Extract changed functions
					const changedFunctions = await this.extractChangedFunctions(
						oldContent,
						newContent,
						absolutePath
					);

					// Calculate line changes
					const { linesAdded, linesRemoved } = this.calculateLineChanges(oldContent, newContent);

					diffMap.set(file, {
						file_path: file,
						old_content: oldContent,
						new_content: newContent,
						changed_functions: changedFunctions,
						lines_added: linesAdded,
						lines_removed: linesRemoved
					});
				} catch (error) {
					console.error(`Error processing file ${file}:`, error);
					// Continue with other files
				}
			}

			return diffMap;
		} catch (error) {
			console.error('Error getting working directory changes:', error);
			throw error;
		}
	}

	/**
	 * Check if current workspace is a git repository
	 */
	private isGitRepository(): boolean {
		try {
			execSync('git rev-parse --is-inside-work-tree', {
				cwd: this.workspaceRoot,
				stdio: 'pipe'
			});
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get list of changed Python files
	 */
	private getChangedPythonFiles(): string[] {
		try {
			// Get modified files
			const statusOutput = execSync('git status --porcelain', {
				cwd: this.workspaceRoot,
				encoding: 'utf-8'
			});

			const files: string[] = [];
			const lines = statusOutput.split('\n').filter(line => line.trim());

			for (const line of lines) {
				// Parse git status output (format: "XY filename")
				const match = line.match(/^(M.|.M|A.) (.+)$/);
				if (match) {
					const filename = match[2].trim();
					// Only include Python files, exclude test files for source changes
					if (filename.endsWith('.py') && !filename.includes('test_')) {
						files.push(filename);
					}
				}
			}

			return files;
		} catch (error) {
			console.error('Error getting changed files:', error);
			return [];
		}
	}

	/**
	 * Get file content from HEAD commit
	 */
	private getFileContentFromHead(filePath: string): string {
		try {
			const content = execSync(`git show HEAD:${filePath}`, {
				cwd: this.workspaceRoot,
				encoding: 'utf-8'
			});
			return content;
		} catch (error) {
			// File doesn't exist in HEAD (newly created)
			return '';
		}
	}

	/**
	 * Get current file content from working directory
	 */
	private async getCurrentFileContent(absolutePath: string): Promise<string> {
		try {
			const uri = vscode.Uri.file(absolutePath);
			const document = await vscode.workspace.openTextDocument(uri);
			return document.getText();
		} catch (error) {
			console.error(`Error reading file ${absolutePath}:`, error);
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
				const newFunctions = await this.extractAllFunctions(newCode, filePath);
				return newFunctions;
			}

			// Analyze both versions
			const oldFunctions = await this.extractAllFunctions(oldCode, filePath);
			const newFunctions = await this.extractAllFunctions(newCode, filePath);

			// Find new or modified functions
			for (const newFunc of newFunctions) {
				if (!oldFunctions.includes(newFunc)) {
					// New function
					changed.push(newFunc);
				} else {
					// Check if implementation changed
					const isChanged = await this.isFunctionModified(
						oldCode,
						newCode,
						newFunc,
						filePath
					);
					if (isChanged) {
						changed.push(newFunc);
					}
				}
			}

			return changed;
		} catch (error) {
			console.error('Error extracting changed functions:', error);
			return [];
		}
	}

	/**
	 * Extract all function names from code
	 */
	private async extractAllFunctions(code: string, filePath: string): Promise<string[]> {
		try {
			// Use AST analyzer to get function information
			const functions: string[] = [];

			// Simple regex-based extraction as fallback
			// Match: def function_name(
			const functionRegex = /^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm;
			let match;

			while ((match = functionRegex.exec(code)) !== null) {
				functions.push(match[1]);
			}

			return functions;
		} catch (error) {
			console.error('Error extracting functions:', error);
			return [];
		}
	}

	/**
	 * Check if a function's implementation has changed
	 */
	private async isFunctionModified(
		oldCode: string,
		newCode: string,
		functionName: string,
		filePath: string
	): Promise<boolean> {
		try {
			const oldFuncCode = this.extractFunctionCode(oldCode, functionName);
			const newFuncCode = this.extractFunctionCode(newCode, functionName);

			return oldFuncCode !== newFuncCode;
		} catch (error) {
			console.error(`Error checking if function ${functionName} modified:`, error);
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

	/**
	 * Get git diff for specific files
	 */
	async getDiffForFiles(filePaths: string[]): Promise<string> {
		try {
			if (!this.isGitRepository() || filePaths.length === 0) {
				return '';
			}

			// Join file paths for git diff command
			const filesString = filePaths.join(' ');
			const diffOutput = execSync(`git diff HEAD -- ${filesString}`, {
				cwd: this.workspaceRoot,
				encoding: 'utf-8'
			});

			return diffOutput;
		} catch (error) {
			console.error('Error getting git diff for files:', error);
			return '';
		}
	}

	/**
	 * Get all test file paths in the workspace
	 */
	async getAllTestFilePaths(): Promise<Array<string>> {
		try {
			const testFiles = await vscode.workspace.findFiles('**/test_*.py', '**/node_modules/**');
			return testFiles.map(fileUri => vscode.workspace.asRelativePath(fileUri));
		} catch (error) {
			console.error('Error getting test file paths:', error);
			return [];
		}
	}

	/**
	 * Get all test files in the workspace
	 */
	async getAllTestFiles(): Promise<string> {
		try {
			const testFiles = await vscode.workspace.findFiles('**/test_*.py', '**/node_modules/**');

			let allTestContent = '';

			for (const fileUri of testFiles) {
				try {
					const document = await vscode.workspace.openTextDocument(fileUri);
					const relativePath = vscode.workspace.asRelativePath(fileUri);
					allTestContent += `\n\n# File: ${relativePath}\n`;
					allTestContent += document.getText();
				} catch (error) {
					console.error(`Error reading test file ${fileUri.fsPath}:`, error);
				}
			}

			return allTestContent;
		} catch (error) {
			console.error('Error getting test files:', error);
			return '';
		}
	}
}
