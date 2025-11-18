/**
 * Analyze Quality Command
 * Scans test files and analyzes them for quality issues
 */

import * as vscode from 'vscode';
import { QualityBackendClient, FileInput, AnalyzeQualityRequest, BackendError } from '../api';
import { QualityTreeProvider } from '../activityBar';
import { QualityConfigManager } from '../utils/config';

export class AnalyzeQualityCommand {
	constructor(
		private backendClient: QualityBackendClient,
		private treeProvider: QualityTreeProvider
	) {}

	/**
	 * Main command handler for analyzing test quality
	 *
	 * Workflow:
	 * 1. Find all test files in workspace
	 * 2. Read file contents
	 * 3. Call backend API
	 * 4. Update tree view with results
	 * 5. Show notifications
	 */
	async execute(): Promise<void> {
		try {
			// Check backend health first
			const isHealthy = await this.backendClient.healthCheck();
			if (!isHealthy) {
				vscode.window.showErrorMessage(
					'Cannot connect to LLT backend. Please make sure it is running at ' +
					QualityConfigManager.getBackendUrl()
				);
				return;
			}

			// Show progress
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'LLT Quality Analysis',
					cancellable: true
				},
				async (progress, token) => {
					// Step 1: Find test files
					progress.report({ message: 'Finding test files...' });
					const testFiles = await this.findTestFiles();

					if (testFiles.length === 0) {
						vscode.window.showInformationMessage(
							'No test files found in workspace'
						);
						return;
					}

					// Step 2: Read file contents
					progress.report({
						message: `Reading ${testFiles.length} test ${testFiles.length === 1 ? 'file' : 'files'}...`
					});
					const filesWithContent = await this.readFileContents(testFiles);

					// Check if cancelled
					if (token.isCancellationRequested) {
						return;
					}

					// Step 3: Build request
					const request = this.buildAnalysisRequest(filesWithContent);

					// Step 4: Call backend API
					progress.report({ message: 'Analyzing test quality...' });
					const startTime = Date.now();
					const result = await this.backendClient.analyzeQuality(request);
					const duration = Date.now() - startTime;

					// Check if cancelled
					if (token.isCancellationRequested) {
						return;
					}

					// Step 5: Update tree view
					this.treeProvider.refresh(result);

					// Step 6: Show summary
					this.showResultSummary(result, duration);
				}
			);
		} catch (error) {
			this.handleError(error);
		}
	}

	/**
	 * Find all pytest test files in the workspace
	 * Looks for files matching pattern: test_*.py or *_test.py
	 */
	private async findTestFiles(): Promise<vscode.Uri[]> {
		const testPatterns = ['**/test_*.py', '**/*_test.py'];
		const excludePatterns = [
			'**/node_modules/**',
			'**/.venv/**',
			'**/venv/**',
			'**/__pycache__/**',
			'**/dist/**',
			'**/build/**'
		];

		const files: vscode.Uri[] = [];

		for (const pattern of testPatterns) {
			const found = await vscode.workspace.findFiles(
				pattern,
				`{${excludePatterns.join(',')}}`
			);
			files.push(...found);
		}

		// Remove duplicates
		const uniqueFiles = Array.from(
			new Map(files.map(f => [f.fsPath, f])).values()
		);

		return uniqueFiles;
	}

	/**
	 * Read contents of all test files
	 */
	private async readFileContents(
		files: vscode.Uri[]
	): Promise<FileInput[]> {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

		const filesWithContent = await Promise.all(
			files.map(async (file) => {
				const content = await vscode.workspace.fs.readFile(file);
				const relativePath = workspaceRoot
					? file.fsPath.replace(workspaceRoot, '').replace(/^\//, '')
					: file.fsPath;

				return {
					path: relativePath,
					content: Buffer.from(content).toString('utf8')
				};
			})
		);

		return filesWithContent;
	}

	/**
	 * Build analysis request with configuration
	 */
	private buildAnalysisRequest(files: FileInput[]): AnalyzeQualityRequest {
		const config = {
			disabled_rules: QualityConfigManager.getDisabledRules(),
			focus_on_changed_lines: false,
			llm_temperature: QualityConfigManager.getLLMTemperature()
		};

		const clientMetadata = {
			extension_version: vscode.extensions.getExtension('llt-assistant')?.packageJSON.version || '0.0.1',
			vscode_version: vscode.version,
			platform: process.platform,
			workspace_hash: this.getWorkspaceHash()
		};

		return {
			files,
			mode: QualityConfigManager.getAnalysisMode(),
			config,
			client_metadata: clientMetadata
		};
	}

	/**
	 * Get workspace hash for tracking
	 */
	private getWorkspaceHash(): string {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		if (!workspaceRoot) {
			return 'unknown';
		}
		// Simple hash based on workspace path
		return Buffer.from(workspaceRoot).toString('base64').substring(0, 16);
	}

	/**
	 * Show summary notification after analysis
	 */
	private showResultSummary(result: any, duration: number): void {
		const { issues, metrics } = result;
		const breakdown = metrics.severity_breakdown;

		const criticalCount = breakdown?.error || 0;
		const warningCount = breakdown?.warning || 0;
		const infoCount = breakdown?.info || 0;

		let message = '';
		if (criticalCount > 0) {
			message = `⚠️  Found ${issues.length} ${issues.length === 1 ? 'issue' : 'issues'} (${criticalCount} critical) in ${metrics.total_tests} ${metrics.total_tests === 1 ? 'test' : 'tests'}`;
		} else if (warningCount > 0) {
			message = `⚡ Found ${issues.length} ${issues.length === 1 ? 'issue' : 'issues'} in ${metrics.total_tests} ${metrics.total_tests === 1 ? 'test' : 'tests'}`;
		} else if (infoCount > 0) {
			message = `ℹ️  Found ${issues.length} ${issues.length === 1 ? 'suggestion' : 'suggestions'} in ${metrics.total_tests} ${metrics.total_tests === 1 ? 'test' : 'tests'}`;
		} else {
			message = `✅ All ${metrics.total_tests} ${metrics.total_tests === 1 ? 'test' : 'tests'} look good!`;
		}

		message += ` (${duration}ms)`;

		if (criticalCount > 0) {
			vscode.window.showWarningMessage(message);
		} else {
			vscode.window.showInformationMessage(message);
		}
	}

	/**
	 * Handle errors during analysis
	 */
	private handleError(error: any): void {
		console.error('LLT Quality Analysis Error:', error);

		let message = 'Failed to analyze test quality';
		let detail = '';

		if (this.isBackendError(error)) {
			const backendError = error as BackendError;
			message = backendError.message;
			detail = backendError.detail;
		} else if (error instanceof Error) {
			detail = error.message;
		} else {
			detail = String(error);
		}

		const fullMessage = detail ? `${message}: ${detail}` : message;
		vscode.window.showErrorMessage(`LLT: ${fullMessage}`);
	}

	/**
	 * Type guard for BackendError
	 */
	private isBackendError(error: any): error is BackendError {
		return error && typeof error.type === 'string' && typeof error.message === 'string';
	}
}
