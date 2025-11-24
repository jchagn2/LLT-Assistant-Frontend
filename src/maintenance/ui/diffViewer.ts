/**
 * Diff Viewer
 * Displays code differences between two versions
 */

import * as vscode from 'vscode';
import { CodeDiff } from '../models/types';

/**
 * Diff Viewer
 * Utility for displaying code differences
 */
export class DiffViewer {
	/**
	 * Show diff in VSCode's built-in diff editor
	 * @param diff Code diff information
	 * @param title Optional title for the diff view
	 */
	static async showDiff(diff: CodeDiff, title?: string): Promise<void> {
		try {
			// Create temporary URIs for old and new content
			const oldUri = vscode.Uri.parse(
				`llt-maintenance-diff:${diff.file_path}?old=true&${Date.now()}`
			);
			const newUri = vscode.Uri.parse(
				`llt-maintenance-diff:${diff.file_path}?new=true&${Date.now()}`
			);

			// Register text document content provider
			const provider = new DiffContentProvider();
			const registration = vscode.workspace.registerTextDocumentContentProvider(
				'llt-maintenance-diff',
				provider
			);

			// Set content
			provider.setContent(oldUri, diff.old_content);
			provider.setContent(newUri, diff.new_content);

			// Show diff
			await vscode.commands.executeCommand('vscode.diff', oldUri, newUri, title || `Diff: ${diff.file_path}`);

			// Clean up after a delay (provider will be disposed when extension deactivates)
			setTimeout(() => {
				// Provider will be cleaned up automatically
			}, 1000);
		} catch (error) {
			console.error('[Maintenance] Error showing diff:', error);
			vscode.window.showErrorMessage(
				`Failed to show diff: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Show unified diff in a new document
	 * @param diff Code diff information
	 */
	static async showUnifiedDiff(diff: CodeDiff): Promise<void> {
		try {
			if (!diff.unified_diff) {
				vscode.window.showWarningMessage('No unified diff available');
				return;
			}

			// Create a new document with the unified diff
			const doc = await vscode.workspace.openTextDocument({
				content: diff.unified_diff,
				language: 'diff'
			});

			await vscode.window.showTextDocument(doc);
		} catch (error) {
			console.error('[Maintenance] Error showing unified diff:', error);
			vscode.window.showErrorMessage(
				`Failed to show unified diff: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}

	/**
	 * Show side-by-side comparison in a custom webview
	 * @param diff Code diff information
	 */
	static async showSideBySideDiff(diff: CodeDiff): Promise<void> {
		try {
			// For now, use the built-in diff viewer
			// In the future, could implement a custom webview for more control
			await this.showDiff(diff, `Side-by-side: ${diff.file_path}`);
		} catch (error) {
			console.error('[Maintenance] Error showing side-by-side diff:', error);
			vscode.window.showErrorMessage(
				`Failed to show side-by-side diff: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	}
}

/**
 * Text document content provider for diff URIs
 */
class DiffContentProvider implements vscode.TextDocumentContentProvider {
	private contentMap = new Map<string, string>();

	setContent(uri: vscode.Uri, content: string): void {
		this.contentMap.set(uri.toString(), content);
	}

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.contentMap.get(uri.toString()) || '';
	}
}

