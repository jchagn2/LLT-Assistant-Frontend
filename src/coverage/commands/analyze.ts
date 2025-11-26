/**
 * Coverage Analysis Commands
 * Handles user commands for coverage optimization
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { CoverageXmlParser, findCoverageFile } from '../parser';
import { CoverageTreeDataProvider } from '../activityBar';
import { CoverageBackendClient } from '../api';
import { UncoveredFunction, PartiallyCoveredFunction, UncoveredRange, RecommendedTest, CoverageReport } from '../api/types';
import { CoverageConfig } from '../utils/config';
import { CoverageCodeLensProvider } from '../codelens/coverageCodeLensProvider';
import { InlinePreviewManager } from '../preview';


export class CoverageCommands {
	private parser: CoverageXmlParser;
	private treeProvider: CoverageTreeDataProvider;
	private backendClient: CoverageBackendClient;
	private statusBarItem: vscode.StatusBarItem;
	private currentCoverageReport: CoverageReport | null = null;
	private codeLensProvider: CoverageCodeLensProvider | null = null;
	private redHighlightStyle: vscode.TextEditorDecorationType;
	private inlinePreviewManager: InlinePreviewManager | null;

	constructor(
		treeProvider: CoverageTreeDataProvider,
		backendClient: CoverageBackendClient,
		codeLensProvider?: CoverageCodeLensProvider,
		inlinePreviewManager?: any
	) {
		this.parser = new CoverageXmlParser({
			minComplexity: CoverageConfig.getMinFunctionComplexity(),
			includeTrivialFunctions: false,
			focusOnBranches: true
		});
		this.treeProvider = treeProvider;
		this.backendClient = backendClient;
		this.codeLensProvider = codeLensProvider || null;
		this.inlinePreviewManager = inlinePreviewManager || null;

		// Create red highlight decoration style
		this.redHighlightStyle = vscode.window.createTextEditorDecorationType({
			backgroundColor: 'rgba(255, 0, 0, 0.15)',
			isWholeLine: true,
			overviewRulerColor: 'red',
			overviewRulerLane: vscode.OverviewRulerLane.Full,
			after: {
				contentText: '  Wait for confirmation...',
				color: 'rgba(255, 100, 100, 0.8)',
				fontStyle: 'italic'
			}
		});

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

					// Save coverage report for later use
					this.currentCoverageReport = coverageReport;

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
	 * Show coverage item: jump to file, highlight uncovered lines, and show CodeLens buttons
	 */
	async showCoverageItem(filePath: string, func: UncoveredFunction | { startLine: number; endLine: number; type?: string }): Promise<void> {
		try {
			// Check if file exists before attempting to open it
			if (!fs.existsSync(filePath)) {
				const fileName = path.basename(filePath);
				const selection = await vscode.window.showWarningMessage(
					`File not found: ${fileName}. The coverage report may be outdated or from a different project.`,
					'Re-analyze Coverage',
					'Dismiss'
				);

				if (selection === 'Re-analyze Coverage') {
					await vscode.commands.executeCommand('llt-assistant.analyzeCoverage');
				}
				return;
			}

			// Open file and jump to the uncovered lines
			const document = await vscode.workspace.openTextDocument(filePath);
			const editor = await vscode.window.showTextDocument(document);

			const startLine = Math.max(0, func.startLine - 1); // Convert to 0-based index
			const endLine = Math.min(document.lineCount - 1, func.endLine - 1);

			const endLineText = document.lineAt(endLine).text;
			const range = new vscode.Range(
				new vscode.Position(startLine, 0),
				new vscode.Position(endLine, endLineText.length)
			);

			// Highlight the uncovered range with red background
			editor.setDecorations(this.redHighlightStyle, [range]);

			// Reveal the range in the center
			editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

			// Add CodeLens request if provider is available
			if (this.codeLensProvider) {
				this.codeLensProvider.addRequest({
					uri: document.uri,
					range: range,
					filePath: filePath,
					func: func
				});
			}
		} catch (error: any) {
			vscode.window.showErrorMessage(
				`Failed to show coverage item: ${error.message || error}`
			);
			console.error('[LLT Coverage] Error showing coverage item:', error);
		}
	}

	/**
	 * Handle CodeLens Yes action
	 */
	async handleCodeLensYes(filePath: string, func: any, uri: vscode.Uri, range: vscode.Range): Promise<void> {
		// Clear highlight and CodeLens
		this.clearHighlightAndCodeLens(uri, range);

		// Proceed with test generation
		await this.generateCoverageTest(filePath, func);
	}

	/**
	 * Handle CodeLens No action
	 */
	async handleCodeLensNo(uri: vscode.Uri, range: vscode.Range): Promise<void> {
		// Clear highlight and CodeLens
		this.clearHighlightAndCodeLens(uri, range);
	}

	/**
	 * Clear highlight and CodeLens for a specific request
	 */
	private clearHighlightAndCodeLens(uri: vscode.Uri, range: vscode.Range): void {
		// Remove CodeLens
		if (this.codeLensProvider) {
			this.codeLensProvider.removeRequest(uri, range);
		}

		// Remove highlight decoration
		const editor = vscode.window.visibleTextEditors.find(
			e => e.document.uri.toString() === uri.toString()
		);
		if (editor) {
			editor.setDecorations(this.redHighlightStyle, []);
		}
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
			// Get backend URL for error message
			const backendUrl = this.backendClient.getBackendUrl?.() || 'unknown';
			vscode.window.showErrorMessage(
				`Cannot connect to LLT backend. Please check your connection.\n` +
				`Backend URL: ${backendUrl}\n` +
				`Check the Developer Console (Help > Toggle Developer Tools) for detailed error logs.`
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

		console.log(`[LLT Coverage] Extracted uncovered ranges for ${filePath}:`, {
			funcName: funcName,
			startLine: func.startLine,
			endLine: func.endLine,
			rangesCount: uncoveredRanges.length,
			ranges: uncoveredRanges
		});

		if (uncoveredRanges.length === 0) {
			vscode.window.showWarningMessage('No uncovered ranges found for this item.');
			console.warn(`[LLT Coverage] No uncovered ranges found for ${filePath}, lines ${func.startLine}-${func.endLine}`);
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

					if (!finalStatus.result || !finalStatus.result.recommended_tests || finalStatus.result.recommended_tests.length === 0) {
						vscode.window.showWarningMessage('No recommended tests generated.');
						return;
					}

					progress.report({ message: 'Preparing test preview...' });

					// Show inline preview for recommended tests
					await this.showRecommendedTestsPreview(
						testFilePath,
						finalStatus.result.recommended_tests,
						filePath,
						func.startLine,
						func.endLine
					);

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
		// First, try to use the already parsed coverage report
		if (this.currentCoverageReport) {
			const fileData = this.currentCoverageReport.files.find(f => {
				// Try exact match first
				if (f.filePath === filePath) {
					return true;
				}
				// Try normalized paths
				const normalized1 = path.normalize(f.filePath);
				const normalized2 = path.normalize(filePath);
				return normalized1 === normalized2;
			});

			if (fileData) {
				console.log(`[LLT Coverage] Found file in coverage report: ${fileData.filePath}`);
				// Re-parse the XML content for this specific file to get uncovered ranges
				// We need to read the XML again to get the class content
				const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
				if (workspaceFolder) {
					const workspaceRoot = workspaceFolder.uri.fsPath;
					const coverageFilePath = await findCoverageFile(workspaceRoot);
					if (coverageFilePath) {
						const xmlContent = await fs.promises.readFile(coverageFilePath, 'utf-8');
						const allRanges = await this.extractRangesFromXml(xmlContent, filePath, workspaceRoot);
						
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
				}
			}
		}

		// Fallback: parse XML directly
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			return [];
		}

		const workspaceRoot = workspaceFolder.uri.fsPath;
		const coverageFilePath = await findCoverageFile(workspaceRoot);
		if (!coverageFilePath) {
			return [];
		}

		const xmlContent = await fs.promises.readFile(coverageFilePath, 'utf-8');
		const allRanges = await this.extractRangesFromXml(xmlContent, filePath, workspaceRoot);

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
	 * Extract uncovered ranges from XML content for a specific file
	 */
	private async extractRangesFromXml(
		xmlContent: string,
		filePath: string,
		workspaceRoot: string
	): Promise<UncoveredRange[]> {
		// Try multiple path formats to match the filename in coverage.xml
		const pathVariants = this.getPathVariants(filePath, workspaceRoot);
		
		let match: RegExpExecArray | null = null;
		for (const pathVariant of pathVariants) {
			const escapedPath = pathVariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const classRegex = new RegExp(
				`<class[^>]*filename="${escapedPath}"[^>]*>([\\s\\S]*?)<\\/class>`,
				'g'
			);
			match = classRegex.exec(xmlContent);
			if (match) {
				console.log(`[LLT Coverage] Matched file in coverage.xml using path: ${pathVariant}`);
				break;
			}
		}

		if (!match) {
			console.error(`[LLT Coverage] Could not find file in coverage.xml. Tried paths:`, pathVariants);
			// Try to find any class element to see what format is used
			const sampleMatch = /<class[^>]*filename="([^"]+)"[^>]*>/g.exec(xmlContent);
			if (sampleMatch) {
				console.log(`[LLT Coverage] Sample filename format in coverage.xml: ${sampleMatch[1]}`);
			}
			return [];
		}

		const classContent = match[1];
		return this.parser.extractUncoveredRanges(classContent);
	}

	/**
	 * Get multiple path variants to try matching against coverage.xml
	 */
	private getPathVariants(absolutePath: string, workspaceRoot?: string): string[] {
		const variants: string[] = [absolutePath];

		if (workspaceRoot) {
			// Try relative path from workspace root
			try {
				const relativePath = path.relative(workspaceRoot, absolutePath);
				if (relativePath && !relativePath.startsWith('..')) {
					variants.push(relativePath);
					// Try with forward slashes (Windows compatibility)
					variants.push(relativePath.replace(/\\/g, '/'));
				}
			} catch {
				// Ignore errors
			}

			// Try path without leading separator
			if (absolutePath.startsWith('/')) {
				variants.push(absolutePath.substring(1));
			}

			// Try just the filename
			variants.push(path.basename(absolutePath));
		}

		return variants;
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
		recommendedTests: RecommendedTest[],
		sourceFilePath: string,
		startLine: number,
		endLine: number
	): Promise<void> {
		// Use the preview manager instance passed from extension
		if (!this.inlinePreviewManager) {
			vscode.window.showErrorMessage('Preview manager not available');
			return;
		}

		const previewManager = this.inlinePreviewManager;

		// Check if test file exists, create it if it doesn't
		if (!fs.existsSync(testFilePath)) {
			// Create the directory if it doesn't exist
			const testDir = path.dirname(testFilePath);
			if (!fs.existsSync(testDir)) {
				await fs.promises.mkdir(testDir, { recursive: true });
			}
			// Create empty test file
			await fs.promises.writeFile(testFilePath, '', 'utf-8');
		}

		// Open test file
		const document = await vscode.workspace.openTextDocument(testFilePath);
		const editor = await vscode.window.showTextDocument(document);

		// Find insert position (end of file)
		// If file is empty, insert at line 0, otherwise at the end
		let position: vscode.Position;
		if (document.lineCount === 0 || (document.lineCount === 1 && document.lineAt(0).text.trim() === '')) {
			position = new vscode.Position(0, 0);
		} else {
			const lastLine = document.lineCount - 1;
			const lastLineText = document.lineAt(lastLine).text;
			// If last line is not empty, add newline before inserting
			if (lastLineText.trim() !== '') {
				position = new vscode.Position(document.lineCount, 0);
			} else {
				position = new vscode.Position(lastLine, 0);
			}
		}

		// Combine all recommended tests
		let combinedTestCode = recommendedTests
			.map(test => test.test_code)
			.join('\n\n');

		// Note: Formatting is now handled by InlinePreviewManager after insertion
		// We don't need to format here anymore

		// Combine scenario descriptions and coverage impacts
		const scenarioDescriptions = recommendedTests
			.map(t => t.scenario_description)
			.filter(Boolean)
			.join('; ');
		const coverageImpacts = recommendedTests
			.map(t => t.expected_coverage_impact)
			.filter(Boolean)
			.join('; ');

		// Get relative path for display
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		let displayPath = sourceFilePath;
		if (workspaceFolder) {
			const relativePath = path.relative(workspaceFolder.uri.fsPath, sourceFilePath);
			if (relativePath && !relativePath.startsWith('..')) {
				displayPath = relativePath;
			}
		}

		// Create coverage info string
		const coverageInfo = `Covers lines ${startLine}-${endLine} in ${displayPath}`;

		// Show preview for all recommended tests
		await previewManager.showPreview(
			editor,
			position,
			combinedTestCode,
			{
				functionName: 'coverage_test',
				explanation: coverageInfo,
				scenarioDescription: scenarioDescriptions,
				expectedCoverageImpact: coverageImpacts
			}
		);
	}

	/**
	 * Format Python code using VSCode native formatter or Python formatter as fallback
	 */
	private async formatPythonCode(code: string): Promise<string> {
		if (!code || !code.trim()) {
			return code;
		}

		// Try VSCode native formatter first
		try {
			const formatted = await this.formatWithVSCode(code);
			if (formatted) {
				return formatted;
			}
		} catch (error) {
			console.warn('[LLT Coverage] VSCode formatter failed, trying Python formatter:', error);
		}

		// Fallback to Python formatter
		try {
			const formatted = await this.formatWithPythonFormatter(code);
			if (formatted) {
				return formatted;
			}
		} catch (error) {
			console.warn('[LLT Coverage] Python formatter failed, using original code:', error);
		}

		// Return original code if all formatters fail
		return code;
	}

	/**
	 * Format code using VSCode's native formatter
	 */
	private async formatWithVSCode(code: string): Promise<string | null> {
		try {
			// Create a temporary file for formatting
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				return null;
			}

			const tempDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
			if (!fs.existsSync(tempDir)) {
				await fs.promises.mkdir(tempDir, { recursive: true });
			}

			const tempFile = path.join(tempDir, `temp_format_${Date.now()}.py`);
			
			// Write code to temp file
			await fs.promises.writeFile(tempFile, code, 'utf-8');

			try {
				// Open the document
				const document = await vscode.workspace.openTextDocument(tempFile);
				const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });

				// Format the document
				await vscode.commands.executeCommand('editor.action.formatDocument');

				// Wait for formatting to complete
				await new Promise(resolve => setTimeout(resolve, 200));

				// Get formatted code
				const formattedCode = document.getText();

				// Close the editor
				await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

				// Clean up temp file
				try {
					await fs.promises.unlink(tempFile);
				} catch {
					// Ignore cleanup errors
				}

				// Return formatted code if it changed, otherwise return null
				return formattedCode !== code ? formattedCode : null;
			} catch (error) {
				// Clean up temp file on error
				try {
					await fs.promises.unlink(tempFile);
				} catch {
					// Ignore cleanup errors
				}
				throw error;
			}
		} catch (error) {
			console.error('[LLT Coverage] VSCode formatter error:', error);
			return null;
		}
	}

	/**
	 * Format code using Python formatter (black or autopep8)
	 */
	private async formatWithPythonFormatter(code: string): Promise<string | null> {
		try {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				return null;
			}

			const formatterPath = path.join(workspaceFolder.uri.fsPath, 'python', 'code_formatter.py');
			
			// Check if formatter script exists
			if (!fs.existsSync(formatterPath)) {
				// Try relative to extension root
				const extensionRoot = path.resolve(__dirname, '../../..');
				const altFormatterPath = path.join(extensionRoot, 'python', 'code_formatter.py');
				if (fs.existsSync(altFormatterPath)) {
					return await this.runPythonFormatter(altFormatterPath, code);
				}
				return null;
			}

			return await this.runPythonFormatter(formatterPath, code);
		} catch (error) {
			console.error('[LLT Coverage] Python formatter error:', error);
			return null;
		}
	}

	/**
	 * Run Python formatter script
	 */
	private async runPythonFormatter(formatterPath: string, code: string): Promise<string | null> {
		return new Promise((resolve) => {
			try {
				// Prepare input as JSON
				const input = JSON.stringify({
					code: code,
					formatter: 'black',
					line_length: 88,
					skip_on_error: true
				});

				// Execute Python formatter using spawn
				const pythonProcess = spawn('python3', [formatterPath], {
					stdio: ['pipe', 'pipe', 'pipe']
				});

				let stdout = '';
				let stderr = '';

				pythonProcess.stdout.on('data', (data) => {
					stdout += data.toString();
				});

				pythonProcess.stderr.on('data', (data) => {
					stderr += data.toString();
				});

				pythonProcess.on('error', (error) => {
					console.error('[LLT Coverage] Python formatter spawn error:', error);
					resolve(null);
				});

				pythonProcess.on('close', (code) => {
					if (code !== 0) {
						console.warn('[LLT Coverage] Python formatter exited with code:', code);
						if (stderr) {
							console.warn('[LLT Coverage] Python formatter stderr:', stderr);
						}
						resolve(null);
						return;
					}

					if (stderr && !stderr.includes('warning')) {
						console.warn('[LLT Coverage] Python formatter stderr:', stderr);
					}

					try {
						// Parse result
						const result = JSON.parse(stdout);
						if (result.success && result.formatted_code) {
							resolve(result.formatted_code);
							return;
						}

						if (result.warning) {
							console.warn('[LLT Coverage] Python formatter warning:', result.warning);
						}

						resolve(null);
					} catch (parseError) {
						console.error('[LLT Coverage] Python formatter JSON parse error:', parseError);
						console.error('[LLT Coverage] Python formatter stdout:', stdout);
						resolve(null);
					}
				});

				// Write input to stdin
				pythonProcess.stdin.write(input);
				pythonProcess.stdin.end();
			} catch (error) {
				console.error('[LLT Coverage] Python formatter execution error:', error);
				resolve(null);
			}
		});
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
		this.redHighlightStyle.dispose();
	}
}
