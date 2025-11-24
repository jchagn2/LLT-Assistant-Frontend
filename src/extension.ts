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

/**
 * Extension activation entry point
 * Called when the extension is first activated
 * @param context - VSCode extension context
 */
export function activate(context: vscode.ExtensionContext) {
	console.log('LLT Assistant extension is now active');

	// ===== Test Generation Feature =====
	// Initialize status bar for test generation
	const testGenStatusBar = new TestGenerationStatusBar();
	context.subscriptions.push(testGenStatusBar);

	// Register CodeLens provider for Python functions
	const codeLensProvider = new TestGenerationCodeLensProvider();
	const codeLensDisposable = vscode.languages.registerCodeLensProvider(
		{ language: 'python', scheme: 'file' },
		codeLensProvider
	);
	context.subscriptions.push(codeLensDisposable);

	// Register the "Generate Tests" command
	const generateTestsCommand = registerGenerateTestsCommand(context, testGenStatusBar);
	context.subscriptions.push(generateTestsCommand);

	// ===== Quality Analysis Feature =====
	// Initialize quality analysis components
	const qualityBackendClient = new QualityBackendClient();
	const qualityTreeProvider = new QualityTreeProvider();
	const qualityStatusBar = new QualityStatusBarManager();
	const issueDecorator = new IssueDecorator();
	const suggestionProvider = new QualitySuggestionProvider();
	const analyzeCommand = new AnalyzeQualityCommand(qualityBackendClient, qualityTreeProvider);

	// Register tree view for quality analysis
	const treeView = vscode.window.createTreeView('lltQualityExplorer', {
		treeDataProvider: qualityTreeProvider,
		showCollapseAll: true
	});
	context.subscriptions.push(treeView);

	// Register code action provider for Python test files
	const codeActionProvider = vscode.languages.registerCodeActionsProvider(
		{ language: 'python', pattern: '**/test_*.py' },
		suggestionProvider,
		{
			providedCodeActionKinds: QualitySuggestionProvider.providedCodeActionKinds
		}
	);
	context.subscriptions.push(codeActionProvider);

	// Update decorations when active editor changes
	const editorChangeListener = vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor && QualityConfigManager.getEnableInlineDecorations()) {
			issueDecorator.updateEditorDecorations(editor);
		}
	});
	context.subscriptions.push(editorChangeListener);

	// Update decorations when visible editors change
	const visibleEditorsListener = vscode.window.onDidChangeVisibleTextEditors(editors => {
		if (QualityConfigManager.getEnableInlineDecorations()) {
			editors.forEach(editor => {
				issueDecorator.updateEditorDecorations(editor);
			});
		}
	});
	context.subscriptions.push(visibleEditorsListener);

	// Shared function for quality analysis execution
	const executeQualityAnalysis = async () => {
		qualityStatusBar.showAnalyzing();
		await analyzeCommand.execute();
		const result = qualityTreeProvider.getAnalysisResult();
		if (result) {
			const criticalCount = result.metrics.severity_breakdown?.error || 0;
			qualityStatusBar.showResults(result.issues.length, criticalCount);

			// Update decorations and suggestions
			if (QualityConfigManager.getEnableInlineDecorations()) {
				issueDecorator.updateIssues(result.issues);
			}
			if (QualityConfigManager.getEnableCodeActions()) {
				suggestionProvider.updateIssues(result.issues);
			}
		} else {
			qualityStatusBar.showIdle();
		}
	};

	// Register quality analysis commands
	const analyzeQualityCommand = vscode.commands.registerCommand(
		'llt-assistant.analyzeQuality',
		executeQualityAnalysis
	);

	const refreshQualityViewCommand = vscode.commands.registerCommand(
		'llt-assistant.refreshQualityView',
		executeQualityAnalysis
	);

	const clearQualityIssuesCommand = vscode.commands.registerCommand(
		'llt-assistant.clearQualityIssues',
		() => {
			qualityTreeProvider.clear();
			issueDecorator.clear();
			suggestionProvider.clear();
			qualityStatusBar.showIdle();
			vscode.window.showInformationMessage('Quality issues cleared');
		}
	);

	const showIssueCommand = vscode.commands.registerCommand(
		'llt-assistant.showIssue',
		async (issue) => {
			try {
				// Navigate to the issue location in the file
				const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
				if (!workspaceRoot) {
					vscode.window.showErrorMessage('No workspace folder open');
					return;
				}

				const filePath = vscode.Uri.file(`${workspaceRoot}/${issue.file}`);

				// Check if file exists
				try {
					await vscode.workspace.fs.stat(filePath);
				} catch {
					vscode.window.showErrorMessage(`File not found: ${issue.file}`);
					return;
				}

				const document = await vscode.workspace.openTextDocument(filePath);
				const editor = await vscode.window.showTextDocument(document);

				// Highlight the line with the issue
				const line = Math.max(0, issue.line - 1); // Convert to 0-indexed
				if (line >= document.lineCount) {
					vscode.window.showErrorMessage(`Line ${issue.line} exceeds file length`);
					return;
				}

				const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);
				editor.selection = new vscode.Selection(range.start, range.end);
				editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to show issue: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	);

	context.subscriptions.push(
		analyzeQualityCommand,
		refreshQualityViewCommand,
		clearQualityIssuesCommand,
		showIssueCommand,
		qualityStatusBar,
		issueDecorator
	);

	// Watch for configuration changes
	const configChangeListener = QualityConfigManager.onDidChange(() => {
		qualityBackendClient.updateBackendUrl();
	});
	context.subscriptions.push(configChangeListener);

	// Auto-analyze feature: analyze when opening test files
	if (QualityConfigManager.getAutoAnalyze()) {
		let autoAnalyzeTimer: NodeJS.Timeout | undefined;

		const autoAnalyzeListener = vscode.workspace.onDidOpenTextDocument(async (document) => {
			if (document.languageId === 'python') {
				const fileName = document.fileName.toLowerCase();
				if (fileName.includes('test_') || fileName.endsWith('_test.py')) {
					// Clear previous timer to implement proper debounce
					if (autoAnalyzeTimer) {
						clearTimeout(autoAnalyzeTimer);
					}

					// Debounce to avoid multiple simultaneous analyses
					autoAnalyzeTimer = setTimeout(() => {
						executeQualityAnalysis();
						autoAnalyzeTimer = undefined;
					}, 1000);
				}
			}
		});
		context.subscriptions.push(autoAnalyzeListener);
	}

	// ===== Coverage Optimization Feature =====
	// Initialize coverage optimization components
	const coverageBackendClient = new CoverageBackendClient();
	const coverageTreeProvider = new CoverageTreeDataProvider();
	const coverageCodeLensProvider = new CoverageCodeLensProvider();
	
	// Initialize preview components for Speculative Insertion
	const reviewCodeLensProvider = new ReviewCodeLensProvider();
	const inlinePreviewManager = new InlinePreviewManager(reviewCodeLensProvider);
	
	const coverageCommands = new CoverageCommands(
		coverageTreeProvider,
		coverageBackendClient,
		coverageCodeLensProvider,
		inlinePreviewManager
	);

	// Register CodeLens provider for coverage
	const coverageCodeLensDisposable = vscode.languages.registerCodeLensProvider(
		{ language: 'python' },
		coverageCodeLensProvider
	);
	context.subscriptions.push(coverageCodeLensDisposable);

	// Register CodeLens provider for review actions (Accept/Discard)
	const reviewCodeLensDisposable = vscode.languages.registerCodeLensProvider(
		{ language: 'python' },
		reviewCodeLensProvider
	);
	context.subscriptions.push(reviewCodeLensDisposable);

	// Register tree view for coverage analysis
	const coverageTreeView = vscode.window.createTreeView('lltCoverageExplorer', {
		treeDataProvider: coverageTreeProvider,
		showCollapseAll: true
	});
	context.subscriptions.push(coverageTreeView);

	// Register coverage analysis commands
	const analyzeCoverageCommand = vscode.commands.registerCommand(
		'llt-assistant.analyzeCoverage',
		() => coverageCommands.analyzeCoverage()
	);

	const refreshCoverageCommand = vscode.commands.registerCommand(
		'llt-assistant.refreshCoverage',
		() => coverageCommands.refreshCoverage()
	);

	const clearCoverageCommand = vscode.commands.registerCommand(
		'llt-assistant.clearCoverage',
		() => coverageCommands.clearCoverage()
	);

	const showCoverageItemCommand = vscode.commands.registerCommand(
		'llt-assistant.showCoverageItem',
		(filePath: string, func: any) => coverageCommands.showCoverageItem(filePath, func)
	);

	const generateCoverageTestCommand = vscode.commands.registerCommand(
		'llt-assistant.generateCoverageTest',
		(filePath: string, func: any) => coverageCommands.generateCoverageTest(filePath, func)
	);

	const batchGenerateTestsCommand = vscode.commands.registerCommand(
		'llt-assistant.batchGenerateTests',
		(filePath: string) => coverageCommands.batchGenerateTests(filePath)
	);

	const showCoverageImprovementCommand = vscode.commands.registerCommand(
		'llt-assistant.showCoverageImprovement',
		() => coverageCommands.showImprovementReport()
	);

	const goToLineCommand = vscode.commands.registerCommand(
		'llt-assistant.goToLine',
		(filePath: string, line: number) => coverageCommands.goToLine(filePath, line)
	);

	// Register CodeLens action commands
	const coverageCodeLensYesCommand = vscode.commands.registerCommand(
		'llt-assistant.coverageCodeLens.yes',
		(filePath: string, func: any, uri: vscode.Uri, range: vscode.Range) => {
			coverageCommands.handleCodeLensYes(filePath, func, uri, range);
		}
	);

	const coverageCodeLensNoCommand = vscode.commands.registerCommand(
		'llt-assistant.coverageCodeLens.no',
		(uri: vscode.Uri, range: vscode.Range) => {
			coverageCommands.handleCodeLensNo(uri, range);
		}
	);

	// Register global commands for inline preview (to avoid duplicate registration)
	const acceptInlinePreviewCommand = vscode.commands.registerCommand(
		'llt-assistant.acceptInlinePreview',
		() => {
			inlinePreviewManager.acceptPreview();
		}
	);

	const rejectInlinePreviewCommand = vscode.commands.registerCommand(
		'llt-assistant.rejectInlinePreview',
		() => {
			inlinePreviewManager.rejectPreview();
		}
	);

	context.subscriptions.push(
		analyzeCoverageCommand,
		refreshCoverageCommand,
		clearCoverageCommand,
		showCoverageItemCommand,
		generateCoverageTestCommand,
		batchGenerateTestsCommand,
		showCoverageImprovementCommand,
		goToLineCommand,
		coverageCodeLensYesCommand,
		coverageCodeLensNoCommand,
		acceptInlinePreviewCommand,
		rejectInlinePreviewCommand,
		inlinePreviewManager,
		coverageCommands
	);

	// ===== Impact Analysis Feature =====
	// Initialize impact analysis components
	const impactClient = new ImpactAnalysisClient();
	const impactTreeProvider = new ImpactTreeProvider();
	const impactAnalyzeCommand = new AnalyzeImpactCommand(impactClient, impactTreeProvider);
	const regenerationDialogManager = new RegenerationDialogManager();

	// Register tree view for impact analysis
	const impactTreeView = vscode.window.createTreeView('lltImpactExplorer', {
		treeDataProvider: impactTreeProvider,
		showCollapseAll: true
	});
	context.subscriptions.push(impactTreeView);

	// Register impact analysis commands
	const analyzeImpactCommand = vscode.commands.registerCommand(
		'llt-assistant.analyzeImpact',
		() => impactAnalyzeCommand.execute()
	);

	const refreshImpactViewCommand = vscode.commands.registerCommand(
		'llt-assistant.refreshImpactView',
		() => impactAnalyzeCommand.execute()
	);

	const clearImpactAnalysisCommand = vscode.commands.registerCommand(
		'llt-assistant.clearImpactAnalysis',
		() => {
			impactTreeProvider.clear();
			vscode.window.showInformationMessage('Impact analysis cleared');
		}
	);

	const switchImpactViewCommand = vscode.commands.registerCommand(
		'llt-assistant.switchImpactView',
		async () => {
			const currentMode = impactTreeProvider.getCurrentViewMode();
			const newMode = currentMode === 'file-to-tests' ? 'tests-to-files' : 'file-to-tests';
			impactTreeProvider.switchView(newMode);

			const modeLabel = newMode === 'file-to-tests' ? 'File → Tests' : 'Tests ← Files';
			vscode.window.showInformationMessage(`Switched to ${modeLabel} view`);
		}
	);

	const regenerateTestsCommand = vscode.commands.registerCommand(
		'llt-assistant.regenerateTests',
		async () => {
			const result = impactTreeProvider.getAnalysisResult();
			if (!result) {
				vscode.window.showWarningMessage('No impact analysis available. Run "Analyze Changes" first.');
				return;
			}

			if (result.affected_tests.length === 0) {
				vscode.window.showInformationMessage('No affected tests to regenerate');
				return;
			}

			// Show decision dialog
			const decision = await regenerationDialogManager.showDecisionDialog(
				result.affected_tests,
				result
			);

			if (decision.cancelled) {
				vscode.window.showInformationMessage('Test regeneration cancelled');
				return;
			}

			if (!decision.confirmed) {
				vscode.window.showInformationMessage('No action taken. Tests remain unchanged.');
				return;
			}

			// Regenerate tests
			await regenerationDialogManager.regenerateTests(
				result.affected_tests,
				result
			);
		}
	);

	context.subscriptions.push(
		analyzeImpactCommand,
		refreshImpactViewCommand,
		clearImpactAnalysisCommand,
		switchImpactViewCommand,
		regenerateTestsCommand
	);

	// ===== Maintenance Feature =====
	const maintenanceClient = new MaintenanceBackendClient();
	const maintenanceTreeProvider = new MaintenanceTreeProvider();
	const decisionDialog = new DecisionDialogManager();

	// Register tree view for maintenance (always register, even without workspace)
	const maintenanceTreeView = vscode.window.createTreeView('lltMaintenanceExplorer', {
		treeDataProvider: maintenanceTreeProvider,
		showCollapseAll: true
	});
	context.subscriptions.push(maintenanceTreeView);

	// Register maintenance commands (always register, check workspace in execute)
	const analyzeMaintenanceCmd = vscode.commands.registerCommand(
		'llt-assistant.analyzeMaintenance',
		async () => {
			const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!workspaceRoot) {
				vscode.window.showWarningMessage(
					'Please open a folder as workspace first. Click "Open Folder" button or use File → Open Folder.'
				);
				return;
			}

			const diffAnalyzer = new GitDiffAnalyzer(workspaceRoot);
			const analyzeMaintenanceCommand = new AnalyzeMaintenanceCommand(
				maintenanceClient,
				maintenanceTreeProvider,
				diffAnalyzer,
				decisionDialog
			);
			await analyzeMaintenanceCommand.execute();
		}
	);

	const refreshMaintenanceViewCmd = vscode.commands.registerCommand(
		'llt-assistant.refreshMaintenanceView',
		async () => {
			const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!workspaceRoot) {
				vscode.window.showWarningMessage(
					'Please open a folder as workspace first. Click "Open Folder" button or use File → Open Folder.'
				);
				return;
			}

			const diffAnalyzer = new GitDiffAnalyzer(workspaceRoot);
			const analyzeMaintenanceCommand = new AnalyzeMaintenanceCommand(
				maintenanceClient,
				maintenanceTreeProvider,
				diffAnalyzer,
				decisionDialog
			);
			await analyzeMaintenanceCommand.execute();
		}
	);

	const clearMaintenanceCmd = vscode.commands.registerCommand(
		'llt-assistant.clearMaintenanceAnalysis',
		() => {
			maintenanceTreeProvider.clear();
			vscode.window.showInformationMessage('Maintenance analysis cleared');
		}
	);

	const batchFixTestsCmd = vscode.commands.registerCommand(
		'llt-assistant.batchFixTests',
		async () => {
			const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!workspaceRoot) {
				vscode.window.showWarningMessage(
					'Please open a folder as workspace first. Click "Open Folder" button or use File → Open Folder.'
				);
				return;
			}

			const batchFixCommand = new BatchFixCommand(maintenanceClient, maintenanceTreeProvider);
			const result = maintenanceTreeProvider.getAnalysisResult();
			if (!result) {
				vscode.window.showWarningMessage(
					'No maintenance analysis available. Run "Analyze Maintenance" first.'
				);
				return;
			}

			// Show decision dialog again if needed
			const decision = await decisionDialog.showDecisionDialog(result);
			if (decision.decision === 'cancelled') {
				return;
			}

			await batchFixCommand.execute(
				decision.decision,
				decision.user_description,
				decision.selected_tests
			);
		}
	);

	context.subscriptions.push(
		analyzeMaintenanceCmd,
		refreshMaintenanceViewCmd,
		clearMaintenanceCmd,
		batchFixTestsCmd
	);

	// Watch for configuration changes
	const maintenanceConfigListener = vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('llt-assistant.maintenance.backendUrl')) {
			maintenanceClient.updateBackendUrl();
		}
	});
	context.subscriptions.push(maintenanceConfigListener);
}

/**
 * Register the "Generate Tests" command (New Async Workflow)
 *
 * Supports two modes:
 * 1. **New Mode** (default): Generate tests for a fresh function
 * 2. **Regenerate Mode**: Called from Feature 3 to regenerate broken tests
 *
 * @param context - Extension context
 * @param statusBar - Status bar manager for progress updates
 * @returns Disposable object
 */
function registerGenerateTestsCommand(
	context: vscode.ExtensionContext,
	statusBar: TestGenerationStatusBar
): vscode.Disposable {
	return vscode.commands.registerCommand('llt-assistant.generateTests', async (args?: {
		functionName?: string;
		uri?: vscode.Uri;
		line?: number;
		mode?: 'new' | 'regenerate';
		targetFunction?: string;
	}) => {
		try {
			// Determine mode (default: 'new')
			const mode = args?.mode || 'new';

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

			// Step 1: Extract source code
			let sourceCode: string;
			let functionName: string | undefined;

			if (args?.functionName || args?.targetFunction) {
				// Called from CodeLens or Feature 3 - extract specific function
				const functionInfo = CodeAnalyzer.extractFunctionInfo(editor);
				if (!functionInfo) {
					await UIDialogs.showError('Could not extract function information.');
					return;
				}
				sourceCode = functionInfo.code;
				functionName = functionInfo.name;
			} else {
				// Called from context menu - extract function at cursor or selection
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

			// Validate the extracted function
			if (!CodeAnalyzer.isValidPythonFunction(sourceCode)) {
				await UIDialogs.showError('The selected text does not appear to be a valid Python function.');
				return;
			}

			// Step 2: Get user's optional test description (skip for regenerate mode)
			let userDescription: string | undefined;

			if (mode === 'new') {
				const input = await UIDialogs.showTestDescriptionInput({
					prompt: 'Describe your test requirements (optional - press Enter to skip)',
					placeHolder: 'e.g., Focus on edge cases, test error handling...'
				});

				// User cancelled
				if (input === undefined) {
					return;
				}

				userDescription = input || undefined;
			} else {
				// Regenerate mode: use default description
				userDescription = 'Regenerate tests to fix broken coverage after code changes';
			}

			// Step 3: Find existing test file
			const existingTestFilePath = await CodeAnalyzer.findExistingTestFile(filePath);
			const existingTestCode = existingTestFilePath
				? await CodeAnalyzer.readFileContent(existingTestFilePath)
				: null;

			// Step 4: Validate configuration
			const configManager = new ConfigurationManager();
			const validation = configManager.validateConfiguration();
			if (!validation.valid) {
				await UIDialogs.showError(
					`Configuration error:\n${validation.errors.join('\n')}`,
					['Open Settings']
				);
				return;
			}

			// Step 5: Build request payload
			const request: GenerateTestsRequest = {
				source_code: sourceCode,
				user_description: userDescription,
				existing_test_code: existingTestCode || undefined,
				context: {
					mode: mode,
					target_function: functionName
				}
			};

			// Step 6: Call backend API (async)
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

			// Step 7: Poll for completion with status bar updates
			vscode.window.showInformationMessage('Test generation task started...');

			const result = await pollTask(
				{
					baseUrl: backendUrl,
					taskId: asyncJobResponse.task_id,
					intervalMs: 1500,
					timeoutMs: 60000
				},
				(event) => {
					// Update status bar based on polling events
					switch (event.type) {
						case 'pending':
							statusBar.showPending();
							break;
						case 'processing':
							statusBar.showProcessing();
							break;
						case 'completed':
							// Will be handled after polling completes
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

			// Step 8: Determine target test file path
			const path = await import('path');
			const targetTestFilePath = existingTestFilePath || await (async () => {
				const workspace = vscode.workspace.workspaceFolders?.[0];
				if (!workspace) {
					return path.join(path.dirname(filePath), `test_${path.basename(filePath)}`);
				}
				const testsDir = path.join(workspace.uri.fsPath, 'tests');
				return path.join(testsDir, `test_${path.basename(filePath)}`);
			})();

			// Step 9: Show diff preview
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

			// Step 10: Write to file
			const fs = await import('fs').then(m => m.promises);
			await fs.mkdir(path.dirname(targetTestFilePath), { recursive: true });
			await fs.writeFile(targetTestFilePath, result.generated_code, 'utf-8');

			// Step 11: Open and show the file
			const document = await vscode.workspace.openTextDocument(targetTestFilePath);
			await vscode.window.showTextDocument(document);

			// Step 12: Show success message
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

/**
 * Extension deactivation
 * Called when the extension is deactivated
 */
export function deactivate() {
	console.log('LLT Assistant extension is deactivated');
}
