/**
 * Coverage Analysis Commands
 * Handles user commands for coverage optimization
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CoverageXmlParser, findCoverageFile } from '../parser';
import { CoverageTreeDataProvider } from '../activityBar';
import { CoverageBackendClient } from '../api';
import { UncoveredFunction, PartiallyCoveredFunction, UncoveredRange, RecommendedTest } from '../api/types';
import { CoverageConfig } from '../utils/config';

export class CoverageCommands {
	private parser: CoverageXmlParser;
	private treeProvider: CoverageTreeDataProvider;
	private backendClient: CoverageBackendClient;
	private statusBarItem: vscode.StatusBarItem;

	constructor(
		treeProvider: CoverageTreeDataProvider,
		backendClient: CoverageBackendClient
	) {
		this.parser = new CoverageXmlParser({
			minComplexity: CoverageConfig.getMinFunctionComplexity(),
			includeTrivialFunctions: false,
			focusOnBranches: true
		});
		this.treeProvider = treeProvider;
		this.backendClient = backendClient;

		// Create status bar item
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			100
		);
		this.statusBarItem.command = 'llt-assistant.analyzeCoverage';
	}

	/**
	 * Analyze coverage command
	 */
	async analyzeCoverage(): Promise<void> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			vscode.window.showErrorMessage('No workspace folder open');
			return;
		}

		const workspaceRoot = workspaceFolder.uri.fsPath;

		// Show progress
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Analyzing Coverage',
				cancellable: false
			},
			async progress => {
				try {
					progress.report({ message: 'Finding coverage.xml...' });

					// Find coverage file
					const coverageFilePath = await findCoverageFile(workspaceRoot);
					if (!coverageFilePath) {
						vscode.window.showWarningMessage(
							'Coverage file not found. Please run: pytest --cov --cov-report=xml',
							'Show Instructions'
						).then(selection => {
							if (selection === 'Show Instructions') {
								this.showCoverageInstructions();
							}
						});
						return;
					}

					progress.report({ message: 'Parsing coverage report...' });

					// Parse coverage file with workspace root for path resolution
					const coverageReport = await this.parser.parse(coverageFilePath, workspaceRoot);

					// Update tree view
					this.treeProvider.updateCoverageReport(coverageReport);

					// Update status bar
					const lineCoverage = (coverageReport.overallStats.lineCoverage * 100).toFixed(1);
					this.statusBarItem.text = `$(graph) Coverage: ${lineCoverage}%`;
					this.statusBarItem.show();

					// Show success message
					const totalIssues = coverageReport.files.reduce(
						(sum, f) => sum + f.uncoveredFunctions.length + f.partiallyCoveredFunctions.length,
						0
					);

					vscode.window.showInformationMessage(
						`Coverage analysis complete: ${lineCoverage}% line coverage, ${totalIssues} improvement opportunities found`
					);
				} catch (error: any) {
					vscode.window.showErrorMessage(
						`Failed to analyze coverage: ${error.message || error}`
					);
					console.error('[LLT Coverage] Analysis error:', error);
				}
			}
		);
	}

	/**
	 * Refresh coverage view
	 */
	async refreshCoverage(): Promise<void> {
		await this.analyzeCoverage();
	}

	/**
	 * Clear coverage data
	 */
	clearCoverage(): void {
		this.treeProvider.clear();
		this.statusBarItem.hide();
		vscode.window.showInformationMessage('Coverage data cleared');
	}

	/**
	 * Generate test for a specific uncovered function or range
	 */
	async generateCoverageTest(filePath: string, func: UncoveredFunction | { startLine: number; endLine: number; type?: string }): Promise<void> {
		// Check file dirty state
		const isDirty = await this.checkFileDirtyState(filePath);
		if (isDirty) {
			const action = await vscode.window.showWarningMessage(
				'Source file has changed. Please run tests again to update coverage report.',
				'Continue Anyway',
				'Cancel'
			);
			if (action !== 'Continue Anyway') {
				return;
			}
		}

		// Check if backend is healthy
		const isHealthy = await this.backendClient.healthCheck();
		if (!isHealthy) {
			vscode.window.showErrorMessage(
				'Cannot connect to LLT backend. Please check your connection.'
			);
			return;
		}

		const funcName = 'name' in func ? func.name : `lines_${func.startLine}_${func.endLine}`;

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Generating test for ${funcName}`,
				cancellable: false
			},
			async progress => {
				try {
					progress.report({ message: 'Reading source code...' });

					// Read full source file code
					const sourceCode = await this.readFullFileCode(filePath);

					// Read existing test file code
					const testFilePath = this.getTestFilePath(filePath);
					const existingTestCode = await this.readExistingTestCode(testFilePath);

					progress.report({ message: 'Extracting uncovered ranges...' });

					// Extract uncovered ranges from coverage.xml
					const uncoveredRanges = await this.extractUncoveredRangesForFile(filePath, func);

					if (uncoveredRanges.length === 0) {
						vscode.window.showWarningMessage('No uncovered ranges found for this item.');
						return;
					}

					progress.report({ message: 'Requesting coverage optimization...' });

					// Call new optimization API
					const taskResponse = await this.backendClient.requestCoverageOptimization({
						source_code: sourceCode,
						existing_test_code: existingTestCode,
						uncovered_ranges: uncoveredRanges,
						framework: 'pytest'
					});

					progress.report({ message: 'Analyzing coverage gaps...', increment: 0 });

					// Poll task status until completion
					const finalStatus = await this.backendClient.pollTaskUntilComplete(
						taskResponse.task_id,
						(status) => {
							progress.report({
								message: `Analyzing coverage gaps... (${status.status})`,
								increment: 0
							});
						}
					);

					if (!finalStatus.result || !finalStatus.result.recommended_tests) {
						vscode.window.showWarningMessage('No recommended tests generated.');
						return;
					}

					progress.report({ message: 'Preparing test preview...' });

					// Show inline preview for recommended tests
					await this.showRecommendedTestsPreview(testFilePath, finalStatus.result.recommended_tests);

					vscode.window.showInformationMessage(
						`Generated ${finalStatus.result.recommended_tests.length} test(s). Press Tab to accept or Esc to reject.`
					);
				} catch (error: any) {
					vscode.window.showErrorMessage(
						`Failed to generate test: ${error.message || error}`
					);
					console.error('[LLT Coverage] Test generation error:', error);
				}
			}
		);
	}

	/**
	 * Batch generate tests for all uncovered functions in a file
	 */
	async batchGenerateTests(filePath: string): Promise<void> {
		vscode.window.showInformationMessage('Batch test generation - Coming soon!');
		// TODO: Implement batch generation
	}

	/**
	 * Show coverage improvement report
	 */
	async showImprovementReport(): Promise<void> {
		vscode.window.showInformationMessage('Coverage improvement report - Coming soon!');
		// TODO: Implement improvement report
	}

	/**
	 * Go to a specific line in a file
	 */
	async goToLine(filePath: string, line: number): Promise<void> {
		try {
			// Try to open the document
			let document: vscode.TextDocument;
			try {
				document = await vscode.workspace.openTextDocument(filePath);
			} catch (error) {
				// If file not found, try to resolve path relative to workspace
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				if (workspaceFolder) {
					const workspaceRoot = workspaceFolder.uri.fsPath;
					const resolvedPath = path.isAbsolute(filePath)
						? filePath
						: path.resolve(workspaceRoot, filePath);
					
					try {
						document = await vscode.workspace.openTextDocument(resolvedPath);
					} catch {
						throw new Error(`File not found: ${filePath}. Tried: ${resolvedPath}`);
					}
				} else {
					throw error;
				}
			}

			const editor = await vscode.window.showTextDocument(document);

			const position = new vscode.Position(line - 1, 0);
			editor.selection = new vscode.Selection(position, position);
			editor.revealRange(
				new vscode.Range(position, position),
				vscode.TextEditorRevealType.InCenter
			);
		} catch (error: any) {
			vscode.window.showErrorMessage(
				`Cannot open file: ${filePath}. ${error.message || error}`
			);
			console.error('[LLT Coverage] Error opening file:', error);
		}
	}

	/**
	 * Check if source file has been modified (dirty state)
	 */
	private async checkFileDirtyState(filePath: string): Promise<boolean> {
		const document = vscode.workspace.textDocuments.find(doc => doc.fileName === filePath);
		if (document && document.isDirty) {
			return true;
		}
		return false;
	}

	/**
	 * Read full source file code
	 */
	private async readFullFileCode(filePath: string): Promise<string> {
		const content = await fs.promises.readFile(filePath, 'utf-8');
		return content;
	}

	/**
	 * Read existing test file code, or return empty string if file doesn't exist
	 */
	private async readExistingTestCode(testFilePath: string): Promise<string> {
		try {
			const content = await fs.promises.readFile(testFilePath, 'utf-8');
			return content;
		} catch {
			return '';
		}
	}

	/**
	 * Extract uncovered ranges for a specific file and function/range
	 */
	private async extractUncoveredRangesForFile(
		filePath: string,
		func: UncoveredFunction | { startLine: number; endLine: number; type?: string }
	): Promise<UncoveredRange[]> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			return [];
		}

		const workspaceRoot = workspaceFolder.uri.fsPath;
		const coverageFilePath = await findCoverageFile(workspaceRoot);
		if (!coverageFilePath) {
			return [];
		}

		// Read and parse coverage.xml
		const xmlContent = await fs.promises.readFile(coverageFilePath, 'utf-8');

		// Find the class element for this file
		const classRegex = new RegExp(
			`<class[^>]*filename="${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([\\s\\S]*?)<\\/class>`,
			'g'
		);
		const match = classRegex.exec(xmlContent);
		if (!match) {
			return [];
		}

		const classContent = match[1];
		const allRanges = this.parser.extractUncoveredRanges(classContent);

		// Filter ranges that overlap with the requested function/range
		const startLine = func.startLine;
		const endLine = func.endLine;
		const relevantRanges = allRanges.filter(range => {
			return (
				(range.start_line >= startLine && range.start_line <= endLine) ||
				(range.end_line >= startLine && range.end_line <= endLine) ||
				(range.start_line <= startLine && range.end_line >= endLine)
			);
		});

		return relevantRanges;
	}

	/**
	 * Extract imports from a Python file
	 */
	private async extractImports(filePath: string): Promise<string> {
		const content = await fs.promises.readFile(filePath, 'utf-8');
		const lines = content.split('\n');

		const imports = lines
			.filter(line => line.trim().startsWith('import ') || line.trim().startsWith('from '))
			.join('\n');

		return imports;
	}

	/**
	 * Show inline preview for recommended tests
	 */
	private async showRecommendedTestsPreview(
		testFilePath: string,
		recommendedTests: RecommendedTest[]
	): Promise<void> {
		// Import InlinePreviewManager
		const { InlinePreviewManager } = await import('../preview/index.js');

		// Create or get preview manager instance
		// Note: In a real implementation, this should be managed at the class level
		const previewManager = new InlinePreviewManager();

		// Open or create test file
		let document: vscode.TextDocument;
		try {
			document = await vscode.workspace.openTextDocument(testFilePath);
		} catch {
			// File doesn't exist, create it
			document = await vscode.workspace.openTextDocument({
				language: 'python',
				content: ''
			});
		}

		const editor = await vscode.window.showTextDocument(document);

		// Find insert position (end of file)
		const lastLine = document.lineCount;
		const position = new vscode.Position(lastLine, 0);

		// Combine all recommended tests
		const combinedTestCode = recommendedTests
			.map(test => test.test_code)
			.join('\n\n');

		// Combine scenario descriptions and coverage impacts
		const scenarioDescriptions = recommendedTests
			.map(t => t.scenario_description)
			.filter(Boolean)
			.join('; ');
		const coverageImpacts = recommendedTests
			.map(t => t.expected_coverage_impact)
			.filter(Boolean)
			.join('; ');

		// Show preview for all recommended tests
		await previewManager.showPreview(
			editor,
			position,
			combinedTestCode,
			{
				functionName: 'coverage_test',
				explanation: scenarioDescriptions,
				scenarioDescription: scenarioDescriptions,
				expectedCoverageImpact: coverageImpacts
			}
		);
	}

	/**
	 * Get test file path for a given source file
	 */
	private getTestFilePath(filePath: string): string {
		const dir = path.dirname(filePath);
		const filename = path.basename(filePath);

		// Try common test file locations
		const testDir = path.join(dir, '..', 'tests');
		const testFilename = filename.startsWith('test_') ? filename : `test_${filename}`;

		// Check if tests directory exists
		if (fs.existsSync(testDir)) {
			return path.join(testDir, testFilename);
		}

		// Fallback: put test file in same directory
		return path.join(dir, testFilename);
	}

	/**
	 * Show instructions for generating coverage report
	 */
	private showCoverageInstructions(): void {
		const panel = vscode.window.createWebviewPanel(
			'coverageInstructions',
			'Coverage Setup Instructions',
			vscode.ViewColumn.One,
			{}
		);

		panel.webview.html = `
			<!DOCTYPE html>
			<html>
			<head>
				<style>
					body { padding: 20px; font-family: var(--vscode-font-family); }
					h1 { color: var(--vscode-foreground); }
					code { background: var(--vscode-textCodeBlock-background); padding: 2px 6px; }
					pre { background: var(--vscode-textCodeBlock-background); padding: 10px; }
				</style>
			</head>
			<body>
				<h1>🎯 Coverage Analysis Setup</h1>
				<p>To use the coverage optimization feature, you need to generate a coverage report first.</p>

				<h2>Step 1: Install pytest-cov</h2>
				<pre><code>pip install pytest-cov</code></pre>

				<h2>Step 2: Run pytest with coverage</h2>
				<pre><code>pytest --cov=. --cov-report=xml</code></pre>

				<p>This will generate a <code>coverage.xml</code> file in your workspace root.</p>

				<h2>Step 3: Analyze Coverage</h2>
				<p>Once the coverage.xml file is generated, click the "Analyze Coverage" button in the LLT Coverage view.</p>
			</body>
			</html>
		`;
	}

	/**
	 * Dispose resources
	 */
	dispose(): void {
		this.statusBarItem.dispose();
	}
}
