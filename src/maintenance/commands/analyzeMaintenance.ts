/**
 * Analyze Maintenance Command
 * Main command handler for maintenance analysis
 */

import * as vscode from 'vscode';
import { GitCommitWatcher } from '../git/commitWatcher';
import { GitDiffAnalyzer } from '../git/diffAnalyzer';
import { MaintenanceBackendClient } from '../api/maintenanceClient';
import { MaintenanceTreeProvider } from '../ui/maintenanceTreeProvider';
import { DiffViewer } from '../ui/diffViewer';
import { DecisionDialogManager } from '../ui/decisionDialog';
import { MaintenanceResult, CodeChange } from '../models/types';
import { AnalyzeMaintenanceRequest, AnalyzeMaintenanceResponse } from '../api/types';

/**
 * Analyze Maintenance Command
 */
export class AnalyzeMaintenanceCommand {
	constructor(
		private client: MaintenanceBackendClient,
		private treeProvider: MaintenanceTreeProvider,
		private diffAnalyzer: GitDiffAnalyzer,
		private decisionDialog: DecisionDialogManager
	) {}

	/**
	 * Execute the analyze maintenance command
	 */
	async execute(): Promise<void> {
		try {
			// Get workspace root
			const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!workspaceRoot) {
				vscode.window.showErrorMessage('No workspace folder open');
				return;
			}

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Analyzing maintenance...',
					cancellable: false
				},
				async (progress) => {
					try {
						// Step 1: Check backend health
						progress.report({ message: 'Checking backend connection...', increment: 10 });
						try {
						const isHealthy = await this.client.checkHealth();
						if (!isHealthy) {
							// Health check failed, but allow user to continue anyway
							// (backend might not have /health endpoint but other APIs work)
							const action = await vscode.window.showWarningMessage(
								'Backend health check failed (this may be normal if /health endpoint is not implemented). Continue anyway?',
								'Continue',
								'Retry',
								'Open Settings',
								'Cancel'
							);
							
							if (action === 'Cancel') {
								return;
							} else if (action === 'Retry') {
								// Retry health check
								const retryHealthy = await this.client.checkHealth();
								if (!retryHealthy) {
									// Still failed, but allow continue
									const continueAction = await vscode.window.showWarningMessage(
										'Health check still failed. Continue anyway?',
										'Continue',
										'Cancel'
									);
									if (continueAction === 'Cancel') {
										return;
									}
									// Continue execution
								}
							} else if (action === 'Open Settings') {
								vscode.commands.executeCommand('workbench.action.openSettings', 'llt-assistant.maintenance.backendUrl');
								return;
							}
							// If action is 'Continue' or undefined, proceed with execution
						}
						} catch (error) {
							// Health check error, but allow user to continue
							const action = await vscode.window.showWarningMessage(
								`Backend health check error: ${error instanceof Error ? error.message : String(error)}. Continue anyway?`,
								'Continue',
								'Retry',
								'Open Settings',
								'Cancel'
							);
							
							if (action === 'Cancel') {
								return;
							} else if (action === 'Retry') {
								await this.execute();
								return;
							} else if (action === 'Open Settings') {
								vscode.commands.executeCommand('workbench.action.openSettings', 'llt-assistant.maintenance.backendUrl');
								return;
							}
							// If action is 'Continue' or undefined, proceed with execution
						}

					// Step 2: Check if workspace is a Git repository
					progress.report({ message: 'Checking Git repository...', increment: 20 });
					const commitWatcher = new GitCommitWatcher(workspaceRoot);
					
					// Check if it's a Git repository
					if (!commitWatcher.isGitRepository()) {
						const action = await vscode.window.showWarningMessage(
							'This workspace is not a Git repository. Maintenance analysis requires a Git repository with at least 2 commits.\n\nWould you like to initialize a Git repository?',
							'Initialize Git',
							'Cancel'
						);
						
						if (action === 'Initialize Git') {
							try {
								const { execSync } = await import('child_process');
								execSync('git init', { cwd: workspaceRoot });
								execSync('git add .', { cwd: workspaceRoot });
								execSync('git commit -m "Initial commit"', { cwd: workspaceRoot });
								vscode.window.showInformationMessage(
									'Git repository initialized. Please make another commit to use maintenance analysis.'
								);
							} catch (error) {
								vscode.window.showErrorMessage(
									`Failed to initialize Git repository: ${error instanceof Error ? error.message : String(error)}`
								);
							}
						}
						return;
					}

					// Get current and previous commit hashes
					progress.report({ message: 'Getting commit information...', increment: 25 });
					const currentCommitHash = commitWatcher.getCurrentCommitHash();
					const previousCommitHash = commitWatcher.getPreviousCommitHash();

					if (!currentCommitHash) {
						const action = await vscode.window.showWarningMessage(
							'No commits found in this Git repository. Maintenance analysis requires at least 2 commits to compare changes.\n\nWould you like to create an initial commit?',
							'Create Initial Commit',
							'Cancel'
						);
						
						if (action === 'Create Initial Commit') {
							try {
								const { execSync } = await import('child_process');
								execSync('git add .', { cwd: workspaceRoot });
								execSync('git commit -m "Initial commit"', { cwd: workspaceRoot });
								vscode.window.showInformationMessage(
									'Initial commit created. Please make another commit to use maintenance analysis.'
								);
							} catch (error) {
								vscode.window.showErrorMessage(
									`Failed to create commit: ${error instanceof Error ? error.message : String(error)}`
								);
							}
						}
						return;
					}

					if (!previousCommitHash) {
						await vscode.window.showInformationMessage(
							'This appears to be the first commit. Maintenance analysis requires at least 2 commits to compare changes.\n\nPlease make another commit to use this feature.',
							'OK'
						);
						return;
					}

						// Step 3: Analyze commit diff
						progress.report({ message: 'Analyzing code changes...', increment: 30 });
						const codeChanges = await this.diffAnalyzer.analyzeCommitDiff(
							previousCommitHash,
							currentCommitHash
						);

						if (codeChanges.size === 0) {
							vscode.window.showInformationMessage('No code changes detected');
							this.treeProvider.clear();
							return;
						}

						// Step 4: Convert to request format
						progress.report({ message: 'Preparing analysis request...', increment: 40 });
						const changes: CodeChange[] = Array.from(codeChanges.values());

						const request: AnalyzeMaintenanceRequest = {
							commit_hash: currentCommitHash,
							previous_commit_hash: previousCommitHash,
							changes
						};

						// Step 5: Send to backend for analysis
						progress.report({ message: 'Identifying affected tests...', increment: 50 });
						
						let response: AnalyzeMaintenanceResponse;
						try {
							response = await this.client.analyzeMaintenance(request);
					} catch (error: any) {
						// Log detailed error for debugging
						console.error('[Maintenance] Analyze API error:', error);
						
						// Check if it's a 404 error (endpoint not found)
						const is404 = error?.statusCode === 404 || 
							error?.message?.includes('404') ||
							error?.message?.includes('endpoint not found') ||
							error?.detail?.includes('Not Found') || 
							error?.detail?.includes('404');
						
						if (is404) {
							// Get backend URL for display
							const config = vscode.workspace.getConfiguration('llt-assistant');
							const backendUrl = config.get<string>('maintenance.backendUrl', 'https://cs5351.efan.dev/api/v1');
							
							const action = await vscode.window.showErrorMessage(
								`Maintenance Analysis Failed: Backend API endpoint not found (404)\n\n` +
								`The endpoint /maintenance/analyze is not implemented or not available.\n\n` +
								`Expected: POST ${backendUrl}/maintenance/analyze\n\n` +
								`Please check with the backend team if the endpoint is available.`,
								'Open Settings',
								'View Logs',
								'Cancel'
							);
							
							if (action === 'Open Settings') {
								vscode.commands.executeCommand('workbench.action.openSettings', 'llt-assistant.maintenance.backendUrl');
							} else if (action === 'View Logs') {
								const outputChannel = vscode.window.createOutputChannel('LLT Maintenance');
								outputChannel.appendLine('='.repeat(60));
								outputChannel.appendLine('Maintenance Analysis Error (404)');
								outputChannel.appendLine('='.repeat(60));
								outputChannel.appendLine(`Error Message: ${error.message || 'Unknown error'}`);
								outputChannel.appendLine(`Status Code: ${error.statusCode || 404}`);
								outputChannel.appendLine(`Detail: ${error.detail || 'Not Found'}`);
								outputChannel.appendLine(`Backend URL: ${backendUrl}`);
								outputChannel.appendLine(`Request Endpoint: ${backendUrl}/maintenance/analyze`);
								outputChannel.appendLine('');
								outputChannel.appendLine('Possible Causes:');
								outputChannel.appendLine('1. The backend endpoint /maintenance/analyze is not implemented');
								outputChannel.appendLine('2. The backend URL is incorrect');
								outputChannel.appendLine('3. The backend server is not running');
								outputChannel.appendLine('4. Network connectivity issues');
								outputChannel.appendLine('');
								outputChannel.appendLine('Please verify the backend endpoint is available at:');
								outputChannel.appendLine(`  ${backendUrl}/maintenance/analyze`);
								outputChannel.show();
							}
							return;
						}
						
						// For other errors, show a generic error message
						const errorMessage = error?.message || 'Unknown error occurred';
						const errorDetail = error?.detail || String(error);
						
						const action = await vscode.window.showErrorMessage(
							`Maintenance analysis failed: ${errorMessage}\n\nDetails: ${errorDetail}`,
							'Retry',
							'View Logs',
							'Cancel'
						);
						
						if (action === 'Retry') {
							await this.execute();
							return;
						} else if (action === 'View Logs') {
							const outputChannel = vscode.window.createOutputChannel('LLT Maintenance');
							outputChannel.appendLine('Maintenance Analysis Error:');
							outputChannel.appendLine(`Error: ${errorMessage}`);
							outputChannel.appendLine(`Detail: ${errorDetail}`);
							outputChannel.show();
						}
						return;
					}

						// Step 6: Build result
						progress.report({ message: 'Building analysis results...', increment: 80 });
						const changeSummary = this.diffAnalyzer.generateChangeSummary(codeChanges);

						const result: MaintenanceResult = {
							context_id: response.context_id,
							commit_hash: currentCommitHash,
							previous_commit_hash: previousCommitHash,
							affected_tests: response.affected_tests,
							change_summary: {
								...changeSummary,
								functions_changed: response.change_summary.functions_changed || changeSummary.functions_changed
							},
							code_changes: changes,
							timestamp: Date.now()
						};

						// Step 7: Update tree view
						progress.report({ message: 'Displaying results...', increment: 100 });
						this.treeProvider.refresh(result);

						// Step 8: Show summary and ask for user decision
						const testsAffected = result.affected_tests.length;
						const summaryMessage = `Maintenance analysis complete: ${testsAffected} test(s) affected`;

						if (testsAffected > 0) {
							// Show diff for first changed file
							if (changes.length > 0) {
								const firstChange = changes[0];
								const diff = await this.diffAnalyzer.getCodeDiff(
									firstChange.file_path,
									previousCommitHash,
									currentCommitHash
								);

								if (diff) {
									// Show diff in a non-blocking way
									setTimeout(() => {
										DiffViewer.showDiff(diff, `Changes in ${firstChange.file_path}`);
									}, 500);
								}
							}

							// Ask user for decision
							const decision = await this.decisionDialog.showDecisionDialog(result);

							if (decision.decision === 'cancelled') {
								vscode.window.showInformationMessage('Maintenance analysis cancelled');
								return;
							}

							// Store decision in context for batch fix command
							// The decision is stored in the tree provider's metadata
							// User can use "Batch Fix Tests" command to apply fixes
							if (decision.decision === 'functionality_changed') {
								vscode.window.showInformationMessage(
									`Decision recorded. Use "Batch Fix Tests" command to regenerate ${decision.selected_tests?.length || testsAffected} test(s).`
								);
							} else {
								vscode.window.showInformationMessage(
									`Decision recorded. Use "Batch Fix Tests" command to improve coverage for ${decision.selected_tests?.length || testsAffected} test(s).`
								);
							}
						} else {
							vscode.window.showInformationMessage(summaryMessage);
						}
					} catch (error) {
						console.error('[Maintenance] Error during analysis:', error);
						
						// Handle backend errors with detailed messages
						if (error && typeof error === 'object' && 'type' in error) {
							const backendError = error as any;
							let errorMessage = 'Maintenance analysis failed: ';
							
							switch (backendError.type) {
								case 'network':
									errorMessage += 'Cannot connect to backend. Please check your network connection and backend URL.';
									break;
								case 'timeout':
									errorMessage += 'Request timed out. The backend may be slow or unavailable.';
									break;
								case 'validation':
									errorMessage += 'Invalid request. Please check your Git repository and try again.';
									break;
								case 'server':
									errorMessage += 'Backend server error. Please try again later or contact support.';
									break;
								default:
									errorMessage += backendError.message || 'Unknown error occurred.';
							}
							
							if (backendError.detail) {
								errorMessage += `\nDetails: ${backendError.detail}`;
							}
							
							vscode.window.showErrorMessage(errorMessage, 'Retry', 'Open Settings').then(selection => {
								if (selection === 'Retry') {
									this.execute();
								} else if (selection === 'Open Settings') {
									vscode.commands.executeCommand('workbench.action.openSettings', 'llt-assistant.maintenance.backendUrl');
								}
							});
						} else {
							vscode.window.showErrorMessage(
								`Maintenance analysis failed: ${error instanceof Error ? error.message : String(error)}`
							);
						}
					}
				}
			);
		} catch (error) {
			console.error('[Maintenance] Error in analyze maintenance command:', error);
			vscode.window.showErrorMessage(
				`Failed to analyze maintenance: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}
}

