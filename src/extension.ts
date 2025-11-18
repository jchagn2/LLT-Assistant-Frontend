/**
 * LLT Assistant - VSCode Extension for Python Test Generation
 *
 * This extension helps developers generate pytest unit tests using AI.
 */

import * as vscode from 'vscode';
import { ConfigurationManager, LLMApiClient, ApiErrorHandler } from './api';
import { UIDialogs } from './ui';
import { CodeAnalyzer } from './utils';
import { PythonASTAnalyzer } from './analysis';
import { AgentFlowController, BackendAgentController, Stage1Response, UserConfirmationResult } from './agents';
import { TestGenerationController } from './generation';

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

	// Register the "Supplement Tests" command
	const supplementTestsCommand = registerSupplementTestsCommand();
	context.subscriptions.push(supplementTestsCommand);
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

			const filePath = editor.document.uri.fsPath;

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

			// Initialize controllers
			const apiMode = configManager.getApiMode();
			const testGenerator = new TestGenerationController();
			const astAnalyzer = new PythonASTAnalyzer();

			// Choose controller based on API mode
			let agentController: AgentFlowController | BackendAgentController;
			if (apiMode === 'backend') {
				// Backend mode - no API key needed
				const backendUrl = configManager.getBackendUrl();
				agentController = new BackendAgentController(backendUrl);
			} else {
				// Direct LLM mode - API key required
				let apiKey: string;
				try {
					apiKey = await configManager.getApiKey();
				} catch (error) {
					// User cancelled API key input
					return;
				}

				const provider = configManager.getApiProvider();
				const modelName = configManager.getModelName();
				agentController = new AgentFlowController(apiKey, provider, modelName);
			}

			await UIDialogs.withIncrementalProgress('Generating tests...', async (updateProgress) => {
				try {
					// Phase 2: Analyze function with Python AST
					updateProgress('Analyzing function code...', 10);
					const analysisResult = await astAnalyzer.buildFunctionContext(
						filePath,
						functionInfo.name
					);

					if (!analysisResult.success) {
						throw new Error(`Failed to analyze function: ${analysisResult.error}`);
					}

					const functionContext = analysisResult.data;

					// Phase 3: Run two-stage agent pipeline
					updateProgress('Identifying test scenarios...', 30);
					const confirmationHandler = async (stage1Response: Stage1Response): Promise<UserConfirmationResult> => {
						// Show scenarios to user for confirmation
						const scenarios = [
							...stage1Response.identified_scenarios.map(s => `✓ ${s.scenario}`),
							...stage1Response.suggested_additional_scenarios.map(s => `? ${s.scenario}`)
						].join('\n');

						const message = `${stage1Response.confirmation_question}\n\nProposed test scenarios:\n${scenarios}\n\nProceed with generation?`;

						const action = await vscode.window.showInformationMessage(
							message,
							{ modal: true },
							'Yes',
							'Add More',
							'Cancel'
						);

						if (action === 'Yes') {
							return { confirmed: true, cancelled: false };
						} else if (action === 'Add More') {
							const additional = await vscode.window.showInputBox({
								prompt: 'Enter additional test scenarios (comma-separated)',
								placeHolder: 'e.g., test with empty input, test with special characters'
							});

							return {
								confirmed: true,
								cancelled: false,
								additionalScenarios: additional || undefined
							};
						} else {
							return { confirmed: false, cancelled: true };
						}
					};

					const pipelineResult = await agentController.runFullPipeline(
						functionContext,
						testDescription,
						confirmationHandler
					);
					updateProgress('Generating test code...', 60);

					if (!pipelineResult.success) {
						throw new Error(pipelineResult.error || 'Pipeline execution failed');
					}

					if (!pipelineResult.stage2Response) {
						throw new Error('No test code generated');
					}

					// Phase 4: Generate and insert test code
					updateProgress('Formatting and validating test code...', 80);
					const generationResult = await testGenerator.generateAndInsertTests(
						pipelineResult.stage2Response,
						functionContext,
						filePath
					);
					updateProgress('Inserting test code into file...', 95);

					if (!generationResult.success) {
						throw new Error(generationResult.error || 'Test generation failed');
					}

					// Show success message
					const warningsText = generationResult.warnings.length > 0
						? `\n\nWarnings:\n${generationResult.warnings.join('\n')}`
						: '';

					await UIDialogs.showSuccess(
						`✓ Test generated successfully!\n\n` +
						`File: ${generationResult.testFilePath}\n` +
						`Tests: ${generationResult.parsedCode.testMethods.length}\n` +
						`Tokens used: ${pipelineResult.totalTokens}\n` +
						`Cost: $${pipelineResult.estimatedCost.toFixed(4)}` +
						warningsText,
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
 * Register the "Supplement Tests" command
 * @returns Disposable object
 */
function registerSupplementTestsCommand(): vscode.Disposable {
	return vscode.commands.registerCommand('llt-assistant.supplementTests', async () => {
		const { executeSupplementTestsCommand } = await import('./commands/supplement-tests.js');
		await executeSupplementTestsCommand();
	});
}

/**
 * Extension deactivation
 * Called when the extension is deactivated
 */
export function deactivate() {
	console.log('LLT Assistant extension is deactivated');
}
