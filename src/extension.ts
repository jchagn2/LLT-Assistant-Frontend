/**
 * LLT Assistant - VSCode Extension for Python Test Generation and Quality Analysis
 *
 * This extension helps developers generate pytest unit tests using AI and
 * analyze test quality for potential issues.
 */

import * as vscode from 'vscode';
import {
  TestGenerationCodeLensProvider,
  TestGenerationStatusBar,
  TestGenerationCommands
} from './generation';
import {
	QualityBackendClient,
	QualityTreeProvider,
	AnalyzeQualityCommand,
	QualityStatusBarManager,
	QualityConfigManager
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

	// Create shared InlinePreviewManager (used by both F1 and F2)
	// Note: This is created here so F1 can use it; F2 will also use the same instance
	const reviewCodeLensProvider = new ReviewCodeLensProvider();
	const inlinePreviewManager = new InlinePreviewManager(reviewCodeLensProvider);

	// Register CodeLens Accept/Discard commands for inline preview (shared by F1 and F2)
	const acceptPreviewDisposable = vscode.commands.registerCommand('llt-assistant.acceptInlinePreview', () => {
		console.log('[LLT] Command llt-assistant.acceptInlinePreview triggered');
		inlinePreviewManager.acceptPreview();
	});
	context.subscriptions.push(acceptPreviewDisposable);

	const rejectPreviewDisposable = vscode.commands.registerCommand('llt-assistant.rejectInlinePreview', () => {
		console.log('[LLT] Command llt-assistant.rejectInlinePreview triggered');
		inlinePreviewManager.rejectPreview();
	});
	context.subscriptions.push(rejectPreviewDisposable);

	// Register ReviewCodeLensProvider (shared by F1 and F2)
	const reviewCodeLensDisposable = vscode.languages.registerCodeLensProvider(
		{ scheme: 'file', language: 'python' },
		reviewCodeLensProvider
	);
	context.subscriptions.push(reviewCodeLensDisposable);

	// Add dispose handler for inline preview manager
	context.subscriptions.push({ dispose: () => inlinePreviewManager.dispose() });

	// Create TestGenerationCommands instance with shared InlinePreviewManager
	const testGenCommands = new TestGenerationCommands(
		testGenStatusBar,
		undefined,  // BackendApiClient will be created internally
		inlinePreviewManager
	);
	const generateTestsDisposable = vscode.commands.registerCommand(
		'llt-assistant.generateTests',
		(args) => testGenCommands.generateTests(args)
	);
	context.subscriptions.push(generateTestsDisposable);

	// ===== Quality Analysis Feature =====
	const qualityBackendClient = new QualityBackendClient();
	const qualityTreeProvider = new QualityTreeProvider();
	const qualityStatusBar = new QualityStatusBarManager();
	// Note: IssueDecorator and QualitySuggestionProvider are not used in basic setup
	const analyzeCommand = new AnalyzeQualityCommand(qualityBackendClient, qualityTreeProvider);

	// Register Quality Analysis commands
	const analyzeQualityDisposable = vscode.commands.registerCommand('llt-assistant.analyzeQuality', () => {
		console.log('[LLT Quality] Command llt-assistant.analyzeQuality triggered');
		analyzeCommand.execute();
	});
	context.subscriptions.push(analyzeQualityDisposable);

	const refreshQualityDisposable = vscode.commands.registerCommand('llt-assistant.refreshQualityView', () => {
		console.log('[LLT Quality] Command llt-assistant.refreshQualityView triggered');
		qualityTreeProvider.refresh();
	});
	context.subscriptions.push(refreshQualityDisposable);

	const clearQualityDisposable = vscode.commands.registerCommand('llt-assistant.clearQualityIssues', () => {
		console.log('[LLT Quality] Command llt-assistant.clearQualityIssues triggered');
		qualityTreeProvider.clear();
	});
	context.subscriptions.push(clearQualityDisposable);

	// Register showIssue command (used by Quality tree view items)
	const showIssueDisposable = vscode.commands.registerCommand(
		'llt-assistant.showIssue',
		async (issue: any) => {
			console.log('[LLT Quality] Command llt-assistant.showIssue triggered');
			try {
				// Backend API uses file_path field (not file)
				const filePath = issue.file_path;

				if (!filePath) {
					vscode.window.showWarningMessage(
						`Cannot navigate to issue: file path is missing`
					);
					console.warn('[LLT Quality] Issue has undefined file_path field:', issue);
					return;
				}

				// Open the file and navigate to the issue location
				const document = await vscode.workspace.openTextDocument(filePath);
				const editor = await vscode.window.showTextDocument(document);

				// Convert to 0-based line number (issue.line is 1-based)
				const line = Math.max(0, issue.line - 1);
				const column = Math.max(0, issue.column || 0);

				const position = new vscode.Position(line, column);
				const range = new vscode.Range(position, position);

				// Reveal and select the issue location
				editor.selection = new vscode.Selection(position, position);
				editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
			} catch (error: any) {
				vscode.window.showErrorMessage(
					`Failed to show issue: ${error.message || error}`
				);
				console.error('[LLT Quality] Error showing issue:', error);
			}
		}
	);
	context.subscriptions.push(showIssueDisposable);

	const qualityTreeView = vscode.window.createTreeView('lltQualityExplorer', {
		treeDataProvider: qualityTreeProvider,
		showCollapseAll: true
	});
	context.subscriptions.push(qualityTreeView);

	console.log('LLT Assistant extension fully activated');
	
	// ===== Impact Analysis Feature (Feature 3) =====
	console.log('[LLT Impact] Initializing Impact Analysis feature...');
	
	try {
		const impactClient = new ImpactAnalysisClient();
		const impactTreeProvider = new ImpactTreeProvider();
		const analyzeImpactCommand = new AnalyzeImpactCommand(impactClient, impactTreeProvider);

		// Register Impact Analysis commands
		const analyzeImpactDisposable = vscode.commands.registerCommand('llt-assistant.analyzeImpact', () => {
			console.log('[LLT Impact] Command llt-assistant.analyzeImpact triggered');
			analyzeImpactCommand.execute();
		});
		context.subscriptions.push(analyzeImpactDisposable);

		const refreshImpactDisposable = vscode.commands.registerCommand('llt-assistant.refreshImpactView', () => {
			console.log('[LLT Impact] Command llt-assistant.refreshImpactView triggered');
			// Just refresh the tree - no data is fetched, this clears the view
			impactTreeProvider.clear();
		});
		context.subscriptions.push(refreshImpactDisposable);

		const clearImpactDisposable = vscode.commands.registerCommand('llt-assistant.clearImpactView', () => {
			console.log('[LLT Impact] Command llt-assistant.clearImpactView triggered');
			impactTreeProvider.clear();
		});
		context.subscriptions.push(clearImpactDisposable);

		// Switch view mode command
		const switchImpactViewDisposable = vscode.commands.registerCommand('llt-assistant.switchImpactView', () => {
			console.log('[LLT Impact] Command llt-assistant.switchImpactView triggered');
			const currentMode = impactTreeProvider.getCurrentViewMode();
			const newMode = currentMode === 'file-to-tests' ? 'tests-to-files' : 'file-to-tests';
			impactTreeProvider.switchView(newMode);
		});
		context.subscriptions.push(switchImpactViewDisposable);

		// Create tree view for Impact Explorer
		const impactTreeView = vscode.window.createTreeView('lltImpactExplorer', {
			treeDataProvider: impactTreeProvider,
			showCollapseAll: true
		});
		context.subscriptions.push(impactTreeView);

		console.log('[LLT Impact] Impact Analysis commands registered successfully');
	} catch (error) {
		console.error('[LLT Impact] Error initializing Impact Analysis:', error);
		vscode.window.showErrorMessage(`Failed to initialize Impact Analysis: ${error instanceof Error ? error.message : String(error)}`);
	}
	
	console.log('[LLT Quality] Commands registered successfully');

	// ===== Coverage Optimization Feature (Feature 2) =====
	console.log('[LLT Coverage] Initializing Coverage Optimization feature...');

	try {
		const coverageBackendClient = new CoverageBackendClient();
		const coverageTreeProvider = new CoverageTreeDataProvider();

		// Create CoverageCodeLensProvider (specific to F2)
		const coverageCodeLensProvider = new CoverageCodeLensProvider();

		// Use shared InlinePreviewManager (created in Test Generation section above)
		// Create CoverageCommands with all required dependencies
		const coverageCommands = new CoverageCommands(
			coverageTreeProvider,
			coverageBackendClient,
			coverageCodeLensProvider,
			inlinePreviewManager  // Shared with F1
		);

		// Register Coverage Analysis commands
		const analyzeCoverageDisposable = vscode.commands.registerCommand('llt-assistant.analyzeCoverage', () => {
			console.log('[LLT Coverage] Command llt-assistant.analyzeCoverage triggered');
			coverageCommands.analyzeCoverage();
		});
		context.subscriptions.push(analyzeCoverageDisposable);

		const refreshCoverageDisposable = vscode.commands.registerCommand('llt-assistant.refreshCoverage', () => {
			console.log('[LLT Coverage] Command llt-assistant.refreshCoverage triggered');
			coverageTreeProvider.refresh();
		});
		context.subscriptions.push(refreshCoverageDisposable);

		const clearCoverageDisposable = vscode.commands.registerCommand('llt-assistant.clearCoverage', () => {
			console.log('[LLT Coverage] Command llt-assistant.clearCoverage triggered');
			coverageCommands.clearCoverage();
		});
		context.subscriptions.push(clearCoverageDisposable);

		// Note: Accept/Discard commands and ReviewCodeLensProvider are already registered
		// in the Test Generation section above (shared between F1 and F2)

		// Register CoverageCodeLensProvider (specific to F2)
		const coverageCodeLensDisposable = vscode.languages.registerCodeLensProvider(
			{ scheme: 'file', language: 'python' },
			coverageCodeLensProvider
		);
		context.subscriptions.push(coverageCodeLensDisposable);

		// Register CodeLens Yes/No commands for coverage confirmation
		const codeLensYesDisposable = vscode.commands.registerCommand(
			'llt-assistant.coverageCodeLensYes',
			(filePath: string, func: any, uri: vscode.Uri, range: vscode.Range) => {
				console.log('[LLT Coverage] CodeLens Yes clicked');
				coverageCommands.handleCodeLensYes(filePath, func, uri, range);
			}
		);
		context.subscriptions.push(codeLensYesDisposable);

		const codeLensNoDisposable = vscode.commands.registerCommand(
			'llt-assistant.coverageCodeLensNo',
			(uri: vscode.Uri, range: vscode.Range) => {
				console.log('[LLT Coverage] CodeLens No clicked');
				coverageCommands.handleCodeLensNo(uri, range);
			}
		);
		context.subscriptions.push(codeLensNoDisposable);

		// Register showCoverageItem command (used by tree view items)
		const showCoverageItemDisposable = vscode.commands.registerCommand(
			'llt-assistant.showCoverageItem',
			(filePath: string, func: any) => {
				console.log('[LLT Coverage] Command llt-assistant.showCoverageItem triggered');
				coverageCommands.showCoverageItem(filePath, func);
			}
		);
		context.subscriptions.push(showCoverageItemDisposable);

		// Register goToLine command (used by Impact tree view)
		const goToLineDisposable = vscode.commands.registerCommand(
			'llt-assistant.goToLine',
			(filePath: string, line: number) => {
				console.log('[LLT Coverage] Command llt-assistant.goToLine triggered');
				coverageCommands.goToLine(filePath, line);
			}
		);
		context.subscriptions.push(goToLineDisposable);

		// Create tree view for Coverage Explorer
		const coverageTreeView = vscode.window.createTreeView('lltCoverageExplorer', {
			treeDataProvider: coverageTreeProvider,
			showCollapseAll: true
		});
		context.subscriptions.push(coverageTreeView);

		console.log('[LLT Coverage] Coverage Analysis commands registered successfully');
	} catch (error) {
		console.error('[LLT Coverage] Error initializing Coverage Analysis:', error);
		vscode.window.showErrorMessage(`Failed to initialize Coverage Analysis: ${error instanceof Error ? error.message : String(error)}`);
	}
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
        // Correct re-index implementation: DELETE -> POST
        await projectIndexer!.reindexProject();
        statusView.refresh();
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

	const testCacheCommand = vscode.commands.registerCommand('llt.debug.testCache', async () => {
		outputChannel.appendLine('=== CACHE DEBUG TEST ===');
		outputChannel.appendLine('Testing cache save and load cycle...');
		
		try {
			outputChannel.appendLine('1. Testing save...');
			await contextState.save();
			outputChannel.appendLine('   Save completed');
			
			outputChannel.appendLine('2. Testing load...');
			const loaded = await contextState.load();
			outputChannel.appendLine(`   Load result: ${loaded ? 'SUCCESS' : 'FAILED'}`);
			if (loaded) {
				outputChannel.appendLine(`   Loaded projectId: ${loaded.projectId}`);
				outputChannel.appendLine(`   Loaded files: ${loaded.statistics.totalFiles}`);
			}
			
			outputChannel.appendLine('=== CACHE TEST COMPLETE ===');
		} catch (error: any) {
			outputChannel.appendLine(`❌ Cache test failed: ${error.message}`);
		}
	});

		context.subscriptions.push(reindexCommand, clearCacheCommand, viewLogsCommand, retryIndexCommand, testCacheCommand);
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
	outputChannel.appendLine('[LLT] Checking cache state...');
	const isIndexed = contextState.isIndexed();
	const isValid = await contextState.isValid();
	outputChannel.appendLine(`[LLT] Cache check complete: isIndexed=${isIndexed}, isValid=${isValid}`);
	
	// Debug: Log current cache content
	const cache = contextState.getCache();
	outputChannel.appendLine(`[LLT] Current cache content: ${cache ? 'EXISTS' : 'NULL'}`);
	if (cache) {
		outputChannel.appendLine(`[LLT] Cache details: projectId=${cache.projectId}, workspace=${cache.workspacePath}, files=${cache.statistics.totalFiles}`);
	}

    try {
        if (!isIndexed) {
            outputChannel.appendLine('[LLT] ⚠️ Branch 1: !isIndexed - no cache found or empty project');
            outputChannel.appendLine('Project has not been indexed. Starting initial indexing...');
            await projectIndexer.initializeProject();
            vscode.window.showInformationMessage('Project indexed successfully!');
        } else if (!isValid) {
            outputChannel.appendLine('[LLT] ⚠️ Branch 2: isIndexed && !isValid - cache exists but is stale');
            outputChannel.appendLine('Cache is outdated or invalid.');
            const action = await vscode.window.showWarningMessage(
                'Project cache is outdated. Re-index to update context?',
                { modal: true },
                'Re-index Now', 'Later'
            );
            if (action === 'Re-index Now') {
                outputChannel.appendLine('User chose to re-index an outdated cache.');
                await projectIndexer.reindexProject();
                vscode.window.showInformationMessage('Project re-indexed successfully!');
            } else {
                outputChannel.appendLine('User skipped re-indexing. Context features may be stale.');
                statusView.setStatus('outdated');
            }
        } else {
            outputChannel.appendLine('[LLT] ✅ Branch 3: isIndexed && isValid - cache is valid, skipping indexing');
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
