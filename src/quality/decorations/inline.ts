/**
 * Inline Issue Decorations
 * Highlights quality issues directly in the code editor
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { QualityIssue, IssueSeverity } from '../api/types';

export class IssueDecorator {
	private errorDecorationType: vscode.TextEditorDecorationType;
	private warningDecorationType: vscode.TextEditorDecorationType;
	private infoDecorationType: vscode.TextEditorDecorationType;

	private issuesByFile: Map<string, QualityIssue[]> = new Map();

	constructor() {
		// Create decoration types for each severity
		this.errorDecorationType = vscode.window.createTextEditorDecorationType({
			textDecoration: 'underline wavy',
			borderWidth: '0 0 2px 0',
			borderStyle: 'solid',
			borderColor: new vscode.ThemeColor('editorError.foreground'),
			overviewRulerColor: new vscode.ThemeColor('editorError.foreground'),
			overviewRulerLane: vscode.OverviewRulerLane.Right
		});

		this.warningDecorationType = vscode.window.createTextEditorDecorationType({
			textDecoration: 'underline',
			borderWidth: '0 0 2px 0',
			borderStyle: 'solid',
			borderColor: new vscode.ThemeColor('editorWarning.foreground'),
			overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
			overviewRulerLane: vscode.OverviewRulerLane.Right
		});

		this.infoDecorationType = vscode.window.createTextEditorDecorationType({
			textDecoration: 'underline dotted',
			borderWidth: '0 0 1px 0',
			borderStyle: 'dotted',
			borderColor: new vscode.ThemeColor('editorInfo.foreground'),
			overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'),
			overviewRulerLane: vscode.OverviewRulerLane.Right
		});
	}

	/**
	 * Update decorations with new analysis results
	 */
	public updateIssues(issues: QualityIssue[]): void {
		// Group issues by file
		this.issuesByFile.clear();
		for (const issue of issues) {
			const fileIssues = this.issuesByFile.get(issue.file_path);
			if (fileIssues) {
				fileIssues.push(issue);
			} else {
				this.issuesByFile.set(issue.file_path, [issue]);
			}
		}

		// Update all visible editors
		vscode.window.visibleTextEditors.forEach(editor => {
			this.updateEditorDecorations(editor);
		});
	}

	/**
	 * Clear all decorations
	 */
	public clear(): void {
		this.issuesByFile.clear();
		vscode.window.visibleTextEditors.forEach(editor => {
			editor.setDecorations(this.errorDecorationType, []);
			editor.setDecorations(this.warningDecorationType, []);
			editor.setDecorations(this.infoDecorationType, []);
		});
	}

	/**
	 * Update decorations for a specific editor
	 */
	public updateEditorDecorations(editor: vscode.TextEditor): void {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		if (!workspaceRoot) {
			console.warn('[LLT Quality] No workspace folder found, cannot update decorations');
			return;
		}

		// Use path.relative for cross-platform compatibility
		const relativePath = path.relative(workspaceRoot, editor.document.uri.fsPath)
			.replace(/\\/g, '/'); // Normalize to forward slashes

		const issues = this.issuesByFile.get(relativePath) || [];

		// Group decorations by severity
		const errorDecorations: vscode.DecorationOptions[] = [];
		const warningDecorations: vscode.DecorationOptions[] = [];
		const infoDecorations: vscode.DecorationOptions[] = [];

		for (const issue of issues) {
			const decoration = this.createDecoration(editor.document, issue);

			switch (issue.severity) {
				case 'error':
					errorDecorations.push(decoration);
					break;
				case 'warning':
					warningDecorations.push(decoration);
					break;
				case 'info':
					infoDecorations.push(decoration);
					break;
			}
		}

		// Apply decorations
		editor.setDecorations(this.errorDecorationType, errorDecorations);
		editor.setDecorations(this.warningDecorationType, warningDecorations);
		editor.setDecorations(this.infoDecorationType, infoDecorations);
	}

	/**
	 * Create a decoration for a single issue
	 */
	private createDecoration(
		document: vscode.TextDocument,
		issue: QualityIssue
	): vscode.DecorationOptions {
		// Line numbers in API are 1-indexed, VSCode uses 0-indexed
		const line = Math.max(0, issue.line - 1);

		// Ensure the line exists
		if (line >= document.lineCount) {
			console.warn(`Issue line ${issue.line} exceeds document line count ${document.lineCount}`);
			return this.createEmptyDecoration();
		}

		const lineText = document.lineAt(line).text;

		// Find the range to underline
		// If we have column info, use it; otherwise underline the whole line
		const startChar = Math.max(0, issue.column > 0 ? issue.column : lineText.search(/\S/));
		const endChar = lineText.length;

		const range = new vscode.Range(
			new vscode.Position(line, startChar),
			new vscode.Position(line, endChar)
		);

		// Create hover message
		const hoverMessage = new vscode.MarkdownString();
		hoverMessage.appendMarkdown(`**${this.formatIssueType(issue.code)}**\n\n`);
		hoverMessage.appendMarkdown(`${issue.message}\n\n`);
		hoverMessage.appendMarkdown(`*Detected by: ${issue.detected_by === 'llm' ? '🤖 AI' : '⚡ Rule Engine'}*\n\n`);

		if (issue.suggestion && issue.suggestion.explanation) {
			hoverMessage.appendMarkdown(`**Suggestion:** ${issue.suggestion.explanation}\n\n`);
		}

		if (issue.suggestion && issue.suggestion.new_code) {
			hoverMessage.appendCodeblock(issue.suggestion.new_code, 'python');
		}

		return {
			range,
			hoverMessage
		};
	}

	/**
	 * Create an empty decoration (for error cases)
	 */
	private createEmptyDecoration(): vscode.DecorationOptions {
		return {
			range: new vscode.Range(0, 0, 0, 0),
			hoverMessage: ''
		};
	}

	/**
	 * Format issue type for display
	 */
	private formatIssueType(type: string): string {
		// Convert "duplicate-assertion" to "Duplicate Assertion"
		return type
			.split('-')
			.map(word => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');
	}

	/**
	 * Dispose all decoration types
	 */
	public dispose(): void {
		this.errorDecorationType.dispose();
		this.warningDecorationType.dispose();
		this.infoDecorationType.dispose();
	}
}
