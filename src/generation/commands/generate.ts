/**
 * Test Generation Commands
 *
 * Handles user commands for test generation (Feature 1)
 * Refactored from extension.ts to follow F2 architecture patterns.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { ConfigurationManager, BackendApiClient } from '../../api';
import { UIDialogs } from '../../ui';
import { CodeAnalyzer } from '../../utils';
import { TestGenerationStatusBar } from '../status-bar-manager';
import { GenerateTestsRequest } from '../types';
import { InlinePreviewManager } from '../../coverage/preview';

/**
 * Arguments for generateTests command
 */
export interface GenerateTestsArgs {
	functionName?: string;
	uri?: vscode.Uri;
	line?: number;
	mode?: 'new' | 'regenerate';
	targetFunction?: string;
}

/**
 * Test Generation Commands
 *
 * Encapsulates all F1 test generation logic.
 * Similar architecture to F2's CoverageCommands class.
 */
export class TestGenerationCommands {
	private statusBar: TestGenerationStatusBar;
	private configManager: ConfigurationManager;
	private backendClient: BackendApiClient;
	private inlinePreviewManager: InlinePreviewManager | null;

	constructor(
		statusBar: TestGenerationStatusBar,
		backendClient?: BackendApiClient,
		inlinePreviewManager?: InlinePreviewManager
	) {
		this.statusBar = statusBar;
		this.configManager = new ConfigurationManager();
		this.backendClient = backendClient || new BackendApiClient(this.configManager.getBackendUrl());
		this.inlinePreviewManager = inlinePreviewManager || null;
	}

	/**
	 * Generate tests for a Python function
	 *
	 * Main entry point for the test generation workflow.
	 */
	async generateTests(args?: GenerateTestsArgs): Promise<void> {
		try {
			// --- Step 1: Determine initial mode from args ---
			const initialMode = args?.mode || 'new';

			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				await UIDialogs.showError('No active editor found. Please open a Python file.');
				return;
			}

			if (editor.document.languageId !== 'python') {
				await UIDialogs.showError('This command only works with Python files.');
				return;
			}

			const filePath = editor.document.uri.fsPath;

			// Get relative path for backend (used to generate correct import statements)
			const relativeFilePath = vscode.workspace.workspaceFolders?.[0]
				? vscode.workspace.asRelativePath(editor.document.uri, false)  // false = no workspace name prefix
				: path.basename(filePath);  // Fallback: use only filename if no workspace

			console.log('[Test Generation] File paths:', {
				absolute: filePath,
				relative: relativeFilePath,
				workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'none'
			});

			let sourceCode: string;
			let functionName: string | undefined;

			if (args?.functionName || args?.targetFunction) {
				const functionInfo = CodeAnalyzer.extractFunctionInfo(editor);
				if (!functionInfo) {
					await UIDialogs.showError('Could not extract function information.');
					return;
				}
				sourceCode = functionInfo.code;
				functionName = functionInfo.name;
			} else {
				const functionInfo = CodeAnalyzer.extractFunctionInfo(editor);
				if (!functionInfo) {
					await UIDialogs.showError(
						'Could not find a Python function. Please place your cursor inside a function or select the function code.'
					);
					return;
				}
				sourceCode = functionInfo.code;
				functionName = functionInfo.name;
			}

			if (!CodeAnalyzer.isValidPythonFunction(sourceCode)) {
				await UIDialogs.showError('The selected text does not appear to be a valid Python function.');
				return;
			}

			let userDescription: string | undefined;

			// --- Step 2: Get user input based on mode ---
			if (initialMode === 'new') {
				const input = await UIDialogs.showTestDescriptionInput({
					prompt: 'Describe your test requirements (optional - press Enter to skip)',
					placeHolder: 'e.g., Focus on edge cases, test error handling...'
				});

				if (input === undefined) {
					return;
				}

				userDescription = input || undefined;
			} else {
				userDescription = 'Regenerate tests to fix broken coverage after code changes';
			}

			const existingTestFilePath = await CodeAnalyzer.findExistingTestFile(filePath);
			const existingTestCode = existingTestFilePath
				? await CodeAnalyzer.readFileContent(existingTestFilePath)
				: null;

			// --- Step 3: Final mode decision ---
			const finalMode = existingTestCode ? 'regenerate' : initialMode;

			const validation = this.configManager.validateConfiguration();
			if (!validation.valid) {
				await UIDialogs.showError(
					`Configuration error:\n${validation.errors.join('\n')}`,
					['Open Settings']
				);
				return;
			}

			// --- Step 4: Build API request ---
			const request: GenerateTestsRequest = {
				source_code: sourceCode,
				user_description: userDescription,
				existing_test_code: existingTestCode || undefined,
				file_path: relativeFilePath,  // Pass relative path for correct import generation
				context: {
					mode: finalMode,
					target_function: functionName
				}
			};

			console.log('[Test Generation] API Request:', {
				source_code_length: sourceCode.length,
				file_path: relativeFilePath,
				mode: finalMode,
				target_function: functionName,
				has_existing_tests: !!existingTestCode
			});

			this.statusBar.showGenerating();

			let asyncJobResponse;
			try {
				asyncJobResponse = await this.backendClient.generateTestsAsync(request);
			} catch (error) {
				this.statusBar.hide();
				await UIDialogs.showError(
					`Failed to start test generation: ${error instanceof Error ? error.message : String(error)}`
				);
				return;
			}

			vscode.window.showInformationMessage('Test generation task started...');

			// --- Step 5: Poll for completion using BackendApiClient.pollTaskUntilComplete ---
			const result = await this.backendClient.pollTaskUntilComplete(
				asyncJobResponse.task_id,
				(status) => {
					switch (status.status) {
						case 'pending':
							this.statusBar.showPending();
							break;
						case 'processing':
							this.statusBar.showProcessing();
							break;
						case 'failed':
							this.statusBar.showError(status.error?.message || 'Task failed');
							break;
					}
				},
				{ intervalMs: 1500, timeoutMs: 60000 }
			).catch(error => {
				this.statusBar.hide();
				throw error;
			});

			this.statusBar.hide();

			// --- Step 6: Determine target test file path ---
			const targetTestFilePath = existingTestFilePath || await (async () => {
				const workspace = vscode.workspace.workspaceFolders?.[0];
				if (!workspace) {
					return path.join(path.dirname(filePath), `test_${path.basename(filePath)}`);
				}
				const testsDir = path.join(workspace.uri.fsPath, 'tests');
				return path.join(testsDir, `test_${path.basename(filePath)}`);
			})();

			// --- Step 7: Show preview (inline or modal based on availability) ---
			if (this.inlinePreviewManager) {
				// Use inline preview (Speculative Insertion pattern)
				await this.showInlinePreview(
					targetTestFilePath,
					existingTestCode,
					result.generated_code,
					functionName,
					result.explanation
				);
			} else {
				// Fallback to modal diff preview
				await this.showModalPreview(
					targetTestFilePath,
					existingTestCode,
					result.generated_code,
					result.explanation
				);
			}

			// --- Step 8: Show success in status bar ---
			const testCount = result.generated_code.split(/\bdef test_/).length - 1;
			this.statusBar.showCompleted(testCount);

		} catch (error) {
			this.statusBar.hide();
			console.error('Error in generateTests command:', error);
			await UIDialogs.showError(
				`Test generation failed: ${error instanceof Error ? error.message : String(error)}`,
				['OK']
			);
		}
	}

	/**
	 * Show inline preview using Speculative Insertion pattern
	 * For test regeneration, replaces entire file content
	 */
	private async showInlinePreview(
		targetTestFilePath: string,
		existingTestCode: string | null,
		generatedCode: string,
		functionName: string | undefined,
		explanation: string
	): Promise<void> {
		// Ensure directory exists
		await fs.promises.mkdir(path.dirname(targetTestFilePath), { recursive: true });

		// Check if file exists
		const fileExists = existingTestCode !== null;

		if (fileExists) {
			// For existing file: REPLACE ALL (user's choice)
			// Open existing file
			const document = await vscode.workspace.openTextDocument(targetTestFilePath);
			const editor = await vscode.window.showTextDocument(document);

			// Delete all existing content first
			const fullRange = new vscode.Range(
				new vscode.Position(0, 0),
				new vscode.Position(document.lineCount, 0)
			);

			const deleteSuccess = await editor.edit(editBuilder => {
				editBuilder.delete(fullRange);
			});

			if (!deleteSuccess) {
				vscode.window.showErrorMessage('Failed to clear existing file');
				return;
			}

			// Wait for document to update
			await new Promise(resolve => setTimeout(resolve, 50));

			// Now show inline preview at position 0 (file is now empty)
			await this.inlinePreviewManager!.showPreview(
				editor,
				new vscode.Position(0, 0),
				generatedCode,
				{
					functionName: functionName || 'test',
					explanation: explanation
				}
			);
		} else {
			// For new file: create empty file and insert
			await fs.promises.writeFile(targetTestFilePath, '', 'utf-8');
			const document = await vscode.workspace.openTextDocument(targetTestFilePath);
			const editor = await vscode.window.showTextDocument(document);

			// Show inline preview at position 0
			await this.inlinePreviewManager!.showPreview(
				editor,
				new vscode.Position(0, 0),
				generatedCode,
				{
					functionName: functionName || 'test',
					explanation: explanation
				}
			);
		}

		vscode.window.showInformationMessage(
			`Generated tests for ${functionName || 'function'}. Use Accept to keep or Discard to remove.`
		);
	}

	/**
	 * Show modal diff preview (fallback when InlinePreviewManager is not available)
	 */
	private async showModalPreview(
		targetTestFilePath: string,
		existingTestCode: string | null,
		generatedCode: string,
		explanation: string
	): Promise<void> {
		const accepted = await UIDialogs.showDiffPreview(
			'Generated Tests Preview',
			existingTestCode || '',
			generatedCode,
			targetTestFilePath
		);

		if (!accepted) {
			vscode.window.showInformationMessage('Test generation cancelled. No changes were made.');
			return;
		}

		// Write test file
		await fs.promises.mkdir(path.dirname(targetTestFilePath), { recursive: true });
		await fs.promises.writeFile(targetTestFilePath, generatedCode, 'utf-8');

		const document = await vscode.workspace.openTextDocument(targetTestFilePath);
		await vscode.window.showTextDocument(document);

		// Show success message
		const testCount = generatedCode.split(/\bdef test_/).length - 1;
		await UIDialogs.showSuccess(
			`✓ Tests generated successfully!\n\n` +
			`File: ${targetTestFilePath}\n` +
			`Tests: ${testCount}\n\n` +
			`${explanation}`,
			['OK']
		);
	}

	/**
	 * Dispose resources
	 */
	dispose(): void {
		// Nothing to dispose currently
	}
}
