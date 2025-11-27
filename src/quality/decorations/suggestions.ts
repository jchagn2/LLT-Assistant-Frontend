/**
 * Code Action Provider for Fix Suggestions
 * Provides quick fix actions (lightbulb) for quality issues
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { QualityIssue } from '../api/types';

export class QualitySuggestionProvider implements vscode.CodeActionProvider {
	private issuesByFile: Map<string, QualityIssue[]> = new Map();

	public static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.QuickFix
	];

	/**
	 * Update issues for suggestion generation
	 */
	public updateIssues(issues: QualityIssue[]): void {
		this.issuesByFile.clear();
		for (const issue of issues) {
			const fileIssues = this.issuesByFile.get(issue.file_path);
			if (fileIssues) {
				fileIssues.push(issue);
			} else {
				this.issuesByFile.set(issue.file_path, [issue]);
			}
		}
	}

	/**
	 * Clear all issues
	 */
	public clear(): void {
		this.issuesByFile.clear();
	}

	/**
	 * Provide code actions for a given document and range
	 * Called by VSCode when user clicks lightbulb or uses Cmd+.
	 */
	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken
	): vscode.CodeAction[] | undefined {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		if (!workspaceRoot) {
			console.warn('[LLT Quality] No workspace folder found, cannot provide code actions');
			return;
		}

		// Use path.relative for cross-platform compatibility
		const relativePath = path.relative(workspaceRoot, document.uri.fsPath)
			.replace(/\\/g, '/'); // Normalize to forward slashes

		const issues = this.issuesByFile.get(relativePath) || [];

		// Find issues that intersect with the current cursor position/selection
		const relevantIssues = issues.filter(issue => {
			const issueLine = issue.line - 1; // Convert to 0-indexed
			return range.start.line <= issueLine && issueLine <= range.end.line;
		});

		if (relevantIssues.length === 0) {
			return undefined;
		}

		// Create code actions for each relevant issue
		const actions: vscode.CodeAction[] = [];

		for (const issue of relevantIssues) {
			const action = this.createCodeAction(document, issue);
			if (action) {
				actions.push(action);
			}
		}

		return actions;
	}

	/**
	 * Create a code action for a specific issue
	 */
	private createCodeAction(
		document: vscode.TextDocument,
		issue: QualityIssue
	): vscode.CodeAction | undefined {
		const suggestion = issue.suggestion;

		// Check if suggestion exists
		if (!suggestion || !suggestion.action) {
			return undefined;
		}

		// Create the code action based on suggestion type
		switch (suggestion.action) {
			case 'remove':
				return this.createRemoveAction(document, issue);
			case 'replace':
				return this.createReplaceAction(document, issue);
			case 'add':
				return this.createAddAction(document, issue);
			default:
				return undefined;
		}
	}

	/**
	 * Create a "Remove" code action
	 */
	private createRemoveAction(
		document: vscode.TextDocument,
		issue: QualityIssue
	): vscode.CodeAction | undefined {
		const line = issue.line - 1;
		if (line >= document.lineCount) {
			return undefined;
		}

		const action = new vscode.CodeAction(
			`🔧 LLT: Remove ${this.formatIssueType(issue.code)}`,
			vscode.CodeActionKind.QuickFix
		);

		action.edit = new vscode.WorkspaceEdit();

		// Remove the entire line
		const lineRange = document.lineAt(line).rangeIncludingLineBreak;
		action.edit.delete(document.uri, lineRange);

		// Add diagnostic information
		action.diagnostics = [this.createDiagnostic(document, issue)];

		// Mark as preferred (will be suggested first)
		action.isPreferred = issue.detected_by === 'rule';

		return action;
	}

	/**
	 * Create a "Replace" code action
	 */
	private createReplaceAction(
		document: vscode.TextDocument,
		issue: QualityIssue
	): vscode.CodeAction | undefined {
		const line = issue.line - 1;
		if (line >= document.lineCount || !issue.suggestion || !issue.suggestion.new_code) {
			return undefined;
		}

		const action = new vscode.CodeAction(
			`🔧 LLT: Fix ${this.formatIssueType(issue.code)}`,
			vscode.CodeActionKind.QuickFix
		);

		action.edit = new vscode.WorkspaceEdit();

		const lineText = document.lineAt(line).text;
		const lineRange = document.lineAt(line).range;

		// Preserve indentation
		const indentation = lineText.match(/^\s*/)?.[0] || '';
		const newCode = issue.suggestion.new_code;
		const newCodeWithIndent = newCode.startsWith(indentation)
			? newCode
			: indentation + newCode.trim();

		action.edit.replace(document.uri, lineRange, newCodeWithIndent);

		action.diagnostics = [this.createDiagnostic(document, issue)];
		action.isPreferred = issue.detected_by === 'rule';

		return action;
	}

	/**
	 * Create an "Add" code action
	 */
	private createAddAction(
		document: vscode.TextDocument,
		issue: QualityIssue
	): vscode.CodeAction | undefined {
		const line = issue.line - 1;
		if (line >= document.lineCount || !issue.suggestion || !issue.suggestion.new_code) {
			return undefined;
		}

		const action = new vscode.CodeAction(
			`🔧 LLT: Add ${this.formatIssueType(issue.code)}`,
			vscode.CodeActionKind.QuickFix
		);

		action.edit = new vscode.WorkspaceEdit();

		const lineText = document.lineAt(line).text;
		const indentation = lineText.match(/^\s*/)?.[0] || '';

		const newCode = issue.suggestion.new_code;
		const newCodeWithIndent = indentation + newCode.trim() + '\n';

		// Insert after the current line
		const insertPosition = new vscode.Position(line + 1, 0);
		action.edit.insert(document.uri, insertPosition, newCodeWithIndent);

		action.diagnostics = [this.createDiagnostic(document, issue)];
		action.isPreferred = false; // Adding code is more risky

		return action;
	}

	/**
	 * Create a diagnostic for the issue
	 * This makes the issue appear in the Problems panel
	 */
	private createDiagnostic(
		document: vscode.TextDocument,
		issue: QualityIssue
	): vscode.Diagnostic {
		const line = issue.line - 1;
		if (line >= document.lineCount) {
			return new vscode.Diagnostic(
				new vscode.Range(0, 0, 0, 0),
				issue.message,
				vscode.DiagnosticSeverity.Warning
			);
		}

		const lineText = document.lineAt(line).text;
		const startChar = Math.max(0, issue.column > 0 ? issue.column : lineText.search(/\S/));

		const range = new vscode.Range(
			new vscode.Position(line, startChar),
			new vscode.Position(line, lineText.length)
		);

		const severity = this.getSeverity(issue.severity);

		const diagnostic = new vscode.Diagnostic(
			range,
			issue.message,
			severity
		);

		diagnostic.source = 'LLT Quality';
		diagnostic.code = issue.code;

		return diagnostic;
	}

	/**
	 * Convert issue severity to VSCode diagnostic severity
	 */
	private getSeverity(severity: string): vscode.DiagnosticSeverity {
		switch (severity) {
			case 'error':
				return vscode.DiagnosticSeverity.Error;
			case 'warning':
				return vscode.DiagnosticSeverity.Warning;
			case 'info':
				return vscode.DiagnosticSeverity.Information;
			default:
				return vscode.DiagnosticSeverity.Hint;
		}
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
}
