/**
 * LLT Assistant - VSCode Extension for Python Test Generation and Quality Analysis
 *
 * This extension helps developers generate pytest unit tests using AI and
 * analyze test quality for potential issues.
 */

import * as vscode from 'vscode';
import { ConfigurationManager, BackendApiClient } from './api';
import { UIDialogs } from './ui';
import { CodeAnalyzer } from './utils';
import {
  TestGenerationCodeLensProvider,
  TestGenerationStatusBar,
  GenerateTestsRequest
} from './generation';
import { pollTask } from './generation/async-task-poller';
import {
	QualityBackendClient,
	QualityTreeProvider,
	AnalyzeQualityCommand,
	QualityStatusBarManager,
	QualityConfigManager,
	IssueDecorator,
	QualitySuggestionProvider
} from './quality';
import {
	CoverageBackendClient,
	CoverageTreeDataProvider,
	CoverageCommands
} from './coverage';
import { CoverageCodeLensProvider } from './coverage/codelens/coverageCodeLensProvider';
import { ReviewCodeLensProvider, InlinePreviewManager } from './coverage/preview';
import {
	ImpactAnalysisClient,
	ImpactTreeProvider,
	AnalyzeImpactCommand,
	RegenerationDialogManager
} from './impact';
import {
	MaintenanceBackendClient,
	GitDiffAnalyzer,
	MaintenanceTreeProvider,
	AnalyzeMaintenanceCommand,
	BatchFixCommand,
	DecisionDialogManager
} from './maintenance';
import { extractSymbolsCommand } from './debug/commands/extractSymbols';
import { runDiagnostic } from './debug/diagnostic';

import { apiClient } from './services/ApiClient';
import { ContextState } from './services/ContextState';
import { ProjectIndexer } from './services/ProjectIndexer';
import { IncrementalUpdater } from './services/IncrementalUpdater';
import { ContextStatusView } from './views/ContextStatusView';
import { waitForLSP, sleep } from './utils/lspWaiter';
import { LSP_INITIAL_DELAY_MS, CANCEL_CLEANUP_DELAY_MS } from './config';

// ===== Global Service References =====
let contextState: ContextState | undefined;
let projectIndexer: ProjectIndexer | undefined;
let incrementalUpdater: IncrementalUpdater | undefined;
let contextStatusView: ContextStatusView | undefined;

/**
 * Extension activation entry point
 * Called when the extension is first activated
 * @param context - VSCode extension context
 */
export async function activate(context: vscode.ExtensionContext) {
	console.log('LLT Assistant extension is now active');

	// ===== Phase 1 Context System Initialization =====
	console.log('[LLT] Initializing Phase 1 Context System...');
	
	const outputChannel = vscode.window.createOutputChannel('LLT Assistant');
	context.subscriptions.push(outputChannel);
	outputChannel.appendLine('LLT Assistant initializing...');

	contextState = new ContextState(context, apiClient);
	await contextState.load();

	projectIndexer = new ProjectIndexer(contextState, outputChannel);
	incrementalUpdater = new IncrementalUpdater(contextState, outputChannel);

	contextStatusView = new ContextStatusView(contextState);
	const treeView = vscode.window.createTreeView('lltContextView', {
		treeDataProvider: contextStatusView,
		showCollapseAll: false
	});
	context.subscriptions.push(treeView);
    contextStatusView.setStatus('initializing');

	registerContextCommands(context, contextState, projectIndexer, contextStatusView, outputChannel);

    // Run startup logic without blocking extension activation
	autoIndexOnStartup(contextState, projectIndexer, contextStatusView, outputChannel).then(() => {
        incrementalUpdater!.startMonitoring();
        context.subscriptions.push(incrementalUpdater!);
        outputChannel.appendLine('File monitoring started for incremental updates.');
    });

	console.log('[LLT] Phase 1 Context System initialized');

	// ===== Phase 0 Debug Feature (EXPERIMENTAL) =====
	const extractSymbolsCommandDisposable = vscode.commands.registerCommand('llt.debug.extractSymbols', extractSymbolsCommand);
	context.subscriptions.push(extractSymbolsCommandDisposable);
	
	const diagnosticCommandDisposable = vscode.commands.registerCommand('llt.debug.diagnostic', runDiagnostic);
	context.subscriptions.push(diagnosticCommandDisposable);

	// ===== Test Generation Feature =====
	const testGenStatusBar = new TestGenerationStatusBar();
	context.subscriptions.push(testGenStatusBar);

	const codeLensProvider = new TestGenerationCodeLensProvider();
	const codeLensDisposable = vscode.languages.registerCodeLensProvider(
		{ language: 'python', scheme: 'file' },
		codeLensProvider
	);
	context.subscriptions.push(codeLensDisposable);

	const generateTestsCommand = registerGenerateTestsCommand(context, testGenStatusBar);
	context.subscriptions.push(generateTestsCommand);

	// ===== Quality Analysis Feature =====
	const qualityBackendClient = new QualityBackendClient();
	const qualityTreeProvider = new QualityTreeProvider();
	const qualityStatusBar = new QualityStatusBarManager();
	const issueDecorator = new IssueDecorator();
	const suggestionProvider = new QualitySuggestionProvider();
	const analyzeCommand = new AnalyzeQualityCommand(qualityBackendClient, qualityTreeProvider);

	const qualityTreeView = vscode.window.createTreeView('lltQualityExplorer', {
		treeDataProvider: qualityTreeProvider,
		showCollapseAll: true
	});
	context.subscriptions.push(qualityTreeView);
	
	console.log('LLT Assistant extension fully activated');
}

/**
 * Register Phase 1 context system commands
 */
function registerContextCommands(
	context: vscode.ExtensionContext,
	contextState: ContextState,
	projectIndexer: ProjectIndexer,
	statusView: ContextStatusView,
	outputChannel: vscode.OutputChannel
): void {
	const reindexCommand = vscode.commands.registerCommand('llt.reindexProject', async () => {
		const confirm = await vscode.window.showWarningMessage(
			'This will re-index all files in the workspace. This may take a few moments. Continue?',
			{ modal: true },
			'Yes', 'No'
		);

		if (confirm !== 'Yes') { return; }

		outputChannel.appendLine('User triggered re-index...');
        // Clear state and re-run the startup logic
        await contextState.clear();
        statusView.refresh();
		await autoIndexOnStartup(contextState, projectIndexer, statusView, outputChannel);
	});

	const clearCacheCommand = vscode.commands.registerCommand('llt.clearCache', async () => {
		const confirm = await vscode.window.showWarningMessage(
			'Are you sure you want to clear the local cache? This will require re-indexing.',
			{ modal: true },
			'Yes', 'No'
		);

		if (confirm !== 'Yes') { return; }

		try {
			outputChannel.appendLine('Clearing cache...');
			await contextState.clear();
            statusView.setStatus('notIndexed');
			vscode.window.showInformationMessage('Cache cleared. Please re-index the project.');
			outputChannel.appendLine('Cache cleared successfully');
		} catch (error: any) {
			vscode.window.showErrorMessage(`Failed to clear cache: ${error.message}`);
			outputChannel.appendLine(`Clear cache error: ${error}`);
		}
	});

	const viewLogsCommand = vscode.commands.registerCommand('llt.viewLogs', () => {
		outputChannel.show();
	});

		// Register command for Activity Bar retry button (reuses reindex logic)
		const retryIndexCommand = vscode.commands.registerCommand('llt.retryIndex', async () => {
			outputChannel.appendLine('User clicked [Retry Index] from Activity Bar...');
			await vscode.commands.executeCommand('llt.reindexProject');
		});

		context.subscriptions.push(reindexCommand, clearCacheCommand, viewLogsCommand, retryIndexCommand);
}

/**
 * Handles the logic for indexing the project on startup, including LSP checks and cache validation.
 */
async function autoIndexOnStartup(
	contextState: ContextState,
	projectIndexer: ProjectIndexer,
	statusView: ContextStatusView,
	outputChannel: vscode.OutputChannel
): Promise<void> {
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		outputChannel.appendLine('No workspace open, skipping auto-indexing.');
        statusView.setStatus('notIndexed');
		return;
	}

    // Phase 1: Wait for LSP to be ready
    outputChannel.appendLine('Waiting for Python LSP to be ready...');
    statusView.setStatus('waitingForLSP');
    await sleep(LSP_INITIAL_DELAY_MS); // Initial delay for LSP startup

    const lspReady = await waitForLSP();
    if (!lspReady) {
        outputChannel.appendLine('❌ Python LSP not ready after multiple retries.');
        statusView.setStatus('lspNotReady');
        
        const selection = await vscode.window.showWarningMessage(
            '⚠️ Python LSP is not ready. Context indexing postponed.\n\n' +
            'Possible reasons:\n' +
            '- Python extension not installed\n' +
            '- LSP service crashed\n' +
            '- Very large project (LSP still analyzing)',
            'Try Now',
            'Try Later',
            'View Logs'
        );
        
        if (selection === 'Try Now') {
            outputChannel.appendLine('User chose to retry indexing immediately');
            vscode.commands.executeCommand('llt.reindexProject');
        } else if (selection === 'View Logs') {
            outputChannel.appendLine('User opened logs to debug LSP issue');
            outputChannel.show();
        } else {
            outputChannel.appendLine('User postponed indexing. Can retry via Activity Bar.');
            // User selected 'Try Later' - they can retry via the Activity Bar button
        }
        return;
    }
    outputChannel.appendLine('✅ LSP is ready.');

	// Phase 2: Check cache state
	const isIndexed = contextState.isIndexed();
	const isValid = await contextState.isValid();

    try {
        if (!isIndexed) {
            outputChannel.appendLine('Project has not been indexed. Starting initial indexing...');
            await projectIndexer.initializeProject();
            vscode.window.showInformationMessage('Project indexed successfully!');
        } else if (!isValid) {
            outputChannel.appendLine('Cache is outdated or invalid.');
            const action = await vscode.window.showWarningMessage(
                'Project cache is outdated. Re-index to update context?',
                { modal: true },
                'Re-index Now', 'Later'
            );
            if (action === 'Re-index Now') {
                outputChannel.appendLine('User chose to re-index an outdated cache.');
                await projectIndexer.initializeProject();
                vscode.window.showInformationMessage('Project re-indexed successfully!');
            } else {
                outputChannel.appendLine('User skipped re-indexing. Context features may be stale.');
                statusView.setStatus('outdated');
            }
        } else {
            const cache = contextState.getCache()!;
            outputChannel.appendLine(
                `Using valid cache. Files: ${cache.statistics.totalFiles}, Symbols: ${cache.statistics.totalSymbols}`
            );
            statusView.setStatus('indexed');
        }
    } catch (error: any) {
        outputChannel.appendLine(`❌ Indexing failed: ${error.message}`);
        if (error.code === 'ECONNREFUSED') {
            statusView.setStatus('backendDown');
            vscode.window.showErrorMessage(
                'Cannot connect to LLT backend. Please ensure the service is running and configured correctly.',
                'Retry', 'Open Settings'
            ).then(selection => {
                if (selection === 'Retry') {
                    vscode.commands.executeCommand('llt.reindexProject');
                } else if (selection === 'Open Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'llt-assistant.backendUrl');
                }
            });
        } else {
            statusView.setStatus('notIndexed');
            vscode.window.showErrorMessage(`An error occurred during indexing: ${error.message}`);
        }
    }

    statusView.refresh();
}

/**
 * Extension deactivation
 */
export async function deactivate() {
	console.log('[LLT] Extension deactivating...');
	try {
		if (projectIndexer?.isIndexing()) {
			console.log('[LLT] Cancelling ongoing indexing...');
			projectIndexer.cancel();
			await sleep(CANCEL_CLEANUP_DELAY_MS); // Allow operations to finish gracefully
		}
		if (contextState) {
			console.log('[LLT] Saving cache state...');
			await contextState.save();
		}
		if (incrementalUpdater) {
			console.log('[LLT] Stopping file monitoring...');
			incrementalUpdater.dispose();
		}
		console.log('[LLT] LLT Assistant deactivated cleanly');
	} catch (error) {
		console.error('[LLT] Error during deactivation:', error);
	}
}

// ... (rest of the file remains unchanged)
function registerGenerateTestsCommand(
	context: vscode.ExtensionContext,
	statusBar: TestGenerationStatusBar
): vscode.Disposable {
	// This function remains exactly the same as in the original
	return vscode.commands.registerCommand('llt-assistant.generateTests', async (args?: {
		functionName?: string;
		uri?: vscode.Uri;
		line?: number;
		mode?: 'new' | 'regenerate';
		targetFunction?: string;
	}) => {
		try {
			const mode = args?.mode || 'new';

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

			if (mode === 'new') {
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

			const configManager = new ConfigurationManager();
			const validation = configManager.validateConfiguration();
			if (!validation.valid) {
				await UIDialogs.showError(
					`Configuration error:\n${validation.errors.join('\n')}`,
					['Open Settings']
				);
				return;
			}

			const request: GenerateTestsRequest = {
				source_code: sourceCode,
				user_description: userDescription,
				existing_test_code: existingTestCode || undefined,
				context: {
					mode: mode,
					target_function: functionName
				}
			};

			const backendUrl = configManager.getBackendUrl();
			const backendClient = new BackendApiClient(backendUrl);

			statusBar.showGenerating();

			let asyncJobResponse;
			try {
				asyncJobResponse = await backendClient.generateTestsAsync(request);
			} catch (error) {
				statusBar.hide();
				await UIDialogs.showError(
					`Failed to start test generation: ${error instanceof Error ? error.message : String(error)}`
				);
				return;
			}

			vscode.window.showInformationMessage('Test generation task started...');

			const result = await pollTask(
				{
					baseUrl: backendUrl,
					taskId: asyncJobResponse.task_id,
					intervalMs: 1500,
					timeoutMs: 60000
				},
				(event) => {
					switch (event.type) {
						case 'pending':
							statusBar.showPending();
							break;
						case 'processing':
							statusBar.showProcessing();
							break;
						case 'completed':
							break;
						case 'failed':
							statusBar.showError(event.error);
							break;
						case 'timeout':
							statusBar.showError('Timeout');
							break;
					}
				}
			).catch(error => {
				statusBar.hide();
				throw error;
			});

			statusBar.hide();

			const path = await import('path');
			const targetTestFilePath = existingTestFilePath || await (async () => {
				const workspace = vscode.workspace.workspaceFolders?.[0];
				if (!workspace) {
					return path.join(path.dirname(filePath), `test_${path.basename(filePath)}`);
				}
				const testsDir = path.join(workspace.uri.fsPath, 'tests');
				return path.join(testsDir, `test_${path.basename(filePath)}`);
			})();

			const accepted = await UIDialogs.showDiffPreview(
				'Generated Tests Preview',
				existingTestCode || '',
				result.generated_code,
				targetTestFilePath
			);

			if (!accepted) {
				vscode.window.showInformationMessage('Test generation cancelled. No changes were made.');
				return;
			}

			const fs = await import('fs').then(m => m.promises);
			await fs.mkdir(path.dirname(targetTestFilePath), { recursive: true });
			await fs.writeFile(targetTestFilePath, result.generated_code, 'utf-8');

			const document = await vscode.workspace.openTextDocument(targetTestFilePath);
			await vscode.window.showTextDocument(document);

			const testCount = result.generated_code.split(/\bdef test_/).length - 1;
			statusBar.showCompleted(testCount);

			await UIDialogs.showSuccess(
				`✓ Tests generated successfully!\n\n` +
				`File: ${targetTestFilePath}\n` +
				`Tests: ${testCount}\n\n` +
				`${result.explanation}`,
				['OK']
			);

		} catch (error) {
			statusBar.hide();
			console.error('Error in generateTests command:', error);
			await UIDialogs.showError(
				`Test generation failed: ${error instanceof Error ? error.message : String(error)}`,
				['OK']
			);
		}
	});
}
