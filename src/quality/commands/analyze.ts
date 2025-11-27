/**
 * Analyze Quality Command
 * Scans test files and analyzes them for quality issues
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { QualityBackendClient, FileInput, AnalyzeQualityRequest, AsyncJobResponse, TaskStatusResponse, BackendError } from '../api';
import { QualityTreeProvider } from '../activityBar';
import { QualityConfigManager, EXTENSION_NAME } from '../utils';

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
					console.log('[LLT Quality] =====================================================================');
					console.log('[LLT Quality] Starting Quality Analysis');
					console.log('[LLT Quality] =====================================================================');

					// Step 1: Find test files
					progress.report({ message: 'Finding test files...' });
					console.log('[LLT Quality] Step 1: Finding test files...');
					const testFiles = await this.findTestFiles();
					console.log(`[LLT Quality] Found ${testFiles.length} test files:`);
					testFiles.slice(0, 5).forEach(file => console.log(`[LLT Quality]   - ${file.fsPath}`));
					if (testFiles.length > 5) {
						console.log(`[LLT Quality]   ... and ${testFiles.length - 5} more files`);
					}

					if (testFiles.length === 0) {
						vscode.window.showInformationMessage(
							'No test files found in workspace'
						);
						console.log('[LLT Quality] No test files found, aborting analysis');
						return;
					}

					// Step 2: Read file contents
					progress.report({
						message: `Reading ${testFiles.length} test ${testFiles.length === 1 ? 'file' : 'files'}...`
					});
					console.log('[LLT Quality] Step 2: Reading file contents...');
					const filesWithContent = await this.readFileContents(testFiles);
					console.log(`[LLT Quality] Successfully read ${filesWithContent.length} files`);
					console.log('[LLT Quality] Sample content sizes:');
					filesWithContent.slice(0, 3).forEach(file => {
						console.log(`[LLT Quality]   - ${file.path}: ${file.content.length} chars`);
					});

					// Check if cancelled
					if (token.isCancellationRequested) {
						console.log('[LLT Quality] Analysis cancelled by user');
						return;
					}

					// Step 3: Build request
					console.log('[LLT Quality] Step 3: Building analysis request...');
					const request = this.buildAnalysisRequest(filesWithContent);
					console.log(`[LLT Quality] Request built with mode: ${request.mode}`);
					console.log(`[LLT Quality] Config:`, JSON.stringify(request.config, null, 2));

					// Step 4: Call backend API (async pattern)
					progress.report({ message: 'Submitting analysis request...' });
					console.log('[LLT Quality] Step 4: Calling backend API (async)...');
					const startTime = Date.now();

					// Submit async analysis request
					const asyncResponse = await this.backendClient.analyzeQualityAsync(request);
					console.log(`[LLT Quality] Async request submitted in ${Date.now() - startTime}ms`);
					console.log(`[LLT Quality] Task ID: ${asyncResponse.task_id}`);
					console.log(`[LLT Quality] Estimated time: ${asyncResponse.estimated_time_seconds}s`);

					// Check if cancelled after submission
					if (token.isCancellationRequested) {
						console.log('[LLT Quality] Analysis cancelled by user after submission');
						return;
					}

					// Poll for results with progress updates
					progress.report({ message: 'Analyzing test quality (waiting for results)...' });
					console.log('[LLT Quality] Polling for results...');

					const result = await this.backendClient.pollTaskUntilComplete(
						asyncResponse.task_id,
						(status) => {
							// Update progress message based on status
							const statusMessage = status.status === 'processing'
								? 'Analyzing test quality (processing)...'
								: 'Analyzing test quality (pending)...';
							progress.report({ message: statusMessage });
							console.log(`[LLT Quality] Task status: ${status.status}`);
						}
					);

					const duration = Date.now() - startTime;
					console.log(`[LLT Quality] API call completed in ${duration}ms`);

					// Check if cancelled
					if (token.isCancellationRequested) {
						console.log('[LLT Quality] Analysis cancelled by user after API response');
						return;
					}

					// Step 5: Update tree view
					console.log('[LLT Quality] Step 5: Updating tree view...');
					this.treeProvider.refresh(result);
					console.log('[LLT Quality] Tree view updated successfully');

					// Step 6: Show summary
					console.log('[LLT Quality] Step 6: Showing result summary...');
					this.showResultSummary(result, duration);
					console.log('[LLT Quality] =====================================================================');
					console.log('[LLT Quality] Analysis completed successfully');
					console.log('[LLT Quality] =====================================================================');
				}
			);
		} catch (error) {
			console.error('[LLT Quality] Analysis failed with error:', error);
			console.error('[LLT Quality] =====================================================================');
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

		if (!workspaceRoot) {
			throw new Error('No workspace folder found');
		}

		const filesWithContent = await Promise.all(
			files.map(async (file) => {
				const content = await vscode.workspace.fs.readFile(file);
				// Use path.relative for cross-platform compatibility
				const relativePath = path.relative(workspaceRoot, file.fsPath)
					.replace(/\\/g, '/'); // Normalize to forward slashes

				return {
					path: relativePath,
					content: Buffer.from(content).toString('utf8')
				};
			})
		);

		// Filter out empty files (backend requires at least 1 character)
		const nonEmptyFiles = filesWithContent.filter(file => file.content.trim().length > 0);

		const emptyFileCount = filesWithContent.length - nonEmptyFiles.length;
		if (emptyFileCount > 0) {
			console.log(`[LLT Quality] Filtered out ${emptyFileCount} empty file(s)`);
		}

		return nonEmptyFiles;
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
			extension_version: vscode.extensions.getExtension(EXTENSION_NAME)?.packageJSON.version || '0.0.1',
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
		const { issues, summary } = result;

		// Use summary object fields provided by the backend
		const totalFiles = summary?.total_files || 0;
		const totalIssues = summary?.total_issues || 0;
		const criticalCount = summary?.critical_issues || 0;

		let message = '';
		if (criticalCount > 0) {
			message = `⚠️  Found ${totalIssues} ${totalIssues === 1 ? 'issue' : 'issues'} (${criticalCount} critical) across ${totalFiles} ${totalFiles === 1 ? 'file' : 'files'}`;
		} else if (totalIssues > 0) {
			message = `⚡ Found ${totalIssues} ${totalIssues === 1 ? 'issue' : 'issues'} across ${totalFiles} ${totalFiles === 1 ? 'file' : 'files'}`;
		} else {
			message = `✅ All ${totalFiles} ${totalFiles === 1 ? 'file' : 'files'} look good!`;
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
