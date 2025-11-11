/**
 * LLT Assistant - VSCode Extension for Python Test Generation
 *
 * This extension helps developers generate pytest unit tests using AI.
 */

import * as vscode from 'vscode';
import { ConfigurationManager, LLMApiClient, ApiErrorHandler } from './api';
import { UIDialogs } from './ui';
import { CodeAnalyzer } from './utils';

/**
 * Extension activation entry point
 * Called when the extension is first activated
 * @param context - VSCode extension context
 */
export function activate(context: vscode.ExtensionContext) {
	console.log('LLT Assistant extension is now active');

	// Register the "Generate Tests" command
	const generateTestsCommand = registerGenerateTestsCommand(context);
	context.subscriptions.push(generateTestsCommand);
}

/**
 * Register the "Generate Tests" command
 * @param context - Extension context
 * @returns Disposable object
 */
function registerGenerateTestsCommand(context: vscode.ExtensionContext): vscode.Disposable {
	return vscode.commands.registerCommand('llt-assistant.generateTests', async () => {
		try {
			// Get active editor
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				await UIDialogs.showError('No active editor found. Please open a Python file.');
				return;
			}

			// Check if it's a Python file
			if (editor.document.languageId !== 'python') {
				await UIDialogs.showError('This command only works with Python files.');
				return;
			}

			// Extract function information from current selection or cursor position
			const functionInfo = CodeAnalyzer.extractFunctionInfo(editor);
			if (!functionInfo) {
				await UIDialogs.showError(
					'Could not find a Python function. Please place your cursor inside a function or select the function code.',
					['OK']
				);
				return;
			}

			// Validate the extracted function
			if (!CodeAnalyzer.isValidPythonFunction(functionInfo.code)) {
				await UIDialogs.showError(
					'The selected text does not appear to be a valid Python function.',
					['OK']
				);
				return;
			}

			// Show function info for confirmation (Phase 1 - just display info)
			await UIDialogs.showSuccess(
				`Found function: ${functionInfo.name}\nParameters: ${functionInfo.parameters.join(', ') || 'none'}\n\nAPI integration is ready! Test generation will be implemented in Phase 2.`,
				['OK']
			);

			// Get user's test description
			const testDescription = await UIDialogs.showTestDescriptionInput();
			if (!testDescription) {
				// User cancelled
				return;
			}

			// Initialize configuration manager
			const configManager = new ConfigurationManager();

			// Validate configuration
			const validation = configManager.validateConfiguration();
			if (!validation.valid) {
				await UIDialogs.showError(
					`Configuration error:\n${validation.errors.join('\n')}`,
					['Open Settings']
				);
				return;
			}

			// Get API key (will prompt if not set)
			let apiKey: string;
			try {
				apiKey = await configManager.getApiKey();
			} catch (error) {
				// User cancelled API key input
				return;
			}

			// Initialize API client
			const provider = configManager.getApiProvider();
			const modelName = configManager.getModelName();
			const apiClient = new LLMApiClient(apiKey, provider, modelName);

			// Phase 1: Just test the API connection with a simple echo
			await UIDialogs.withProgress('Testing API connection...', async () => {
				try {
					const response = await apiClient.callWithRetry([
						{
							role: 'system',
							content: 'You are a helpful assistant. Respond with "API connection successful!"'
						},
						{
							role: 'user',
							content: 'Hello'
						}
					]);

					const usage = apiClient.getTokenUsage();
					await UIDialogs.showSuccess(
						`✓ API Connection Successful!\n\nModel: ${response.model}\nTokens used: ${usage.totalTokens}\nEstimated cost: $${usage.totalCost.toFixed(4)}\n\n` +
						`Function: ${functionInfo.name}\nDescription: ${testDescription}\n\n` +
						`Full test generation will be implemented in Phase 2.`,
						['OK']
					);
				} catch (error) {
					const errorHandler = new ApiErrorHandler();
					const errorResult = errorHandler.handleError(error);
					await UIDialogs.showError(errorResult.userMessage, ['OK']);
				}
			});

		} catch (error) {
			console.error('Error in generateTests command:', error);
			await UIDialogs.showError(
				`An unexpected error occurred: ${error instanceof Error ? error.message : String(error)}`,
				['OK']
			);
		}
	});
}

/**
 * Extension deactivation
 * Called when the extension is deactivated
 */
export function deactivate() {
	console.log('LLT Assistant extension is deactivated');
}
