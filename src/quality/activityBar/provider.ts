/**
 * Tree View Data Provider for Quality Analysis Results
 */

import * as vscode from 'vscode';
import { AnalyzeQualityResponse, QualityIssue, IssueSeverity } from '../api/types';
import { TreeItemType, QualityTreeItem } from './types';
import { QualityConfigManager } from '../utils/config';

export class QualityTreeProvider implements vscode.TreeDataProvider<QualityTreeItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<QualityTreeItem | undefined> =
		new vscode.EventEmitter<QualityTreeItem | undefined>();
	readonly onDidChangeTreeData: vscode.Event<QualityTreeItem | undefined> =
		this._onDidChangeTreeData.event;

	private analysisResult: AnalyzeQualityResponse | null = null;

	constructor() {}

	/**
	 * Refresh the tree view with new analysis results
	 */
	public refresh(result?: AnalyzeQualityResponse): void {
		if (result) {
			this.analysisResult = result;
		}
		this._onDidChangeTreeData.fire(undefined);
	}

	/**
	 * Clear all issues from the tree view
	 */
	public clear(): void {
		this.analysisResult = null;
		this._onDidChangeTreeData.fire(undefined);
	}

	/**
	 * Get tree item for display in the view
	 */
	getTreeItem(element: QualityTreeItem): vscode.TreeItem {
		const treeItem = new vscode.TreeItem(
			element.label,
			element.collapsibleState
		);

		treeItem.description = element.description;
		treeItem.tooltip = element.tooltip;
		treeItem.iconPath = element.iconPath;
		treeItem.contextValue = element.contextValue;
		treeItem.command = element.command;

		return treeItem;
	}

	/**
	 * Get children for a tree item
	 * Root level: returns [Summary, File1, File2, ...]
	 * File level: returns [Issue1, Issue2, ...]
	 * Issue level: returns []
	 */
	getChildren(element?: QualityTreeItem): Thenable<QualityTreeItem[]> {
		if (!this.analysisResult) {
			// No analysis run yet - show empty state
			return Promise.resolve([this.createEmptyStateItem()]);
		}

		if (!element) {
			// Root level - return summary + files
			return Promise.resolve(this.getRootItems());
		}

		if (element.type === TreeItemType.File) {
			// File level - return issues for this file
			return Promise.resolve(this.getIssuesForFile(element.filePath!));
		}

		// Issue level - no children
		return Promise.resolve([]);
	}

	/**
	 * Get filtered issues based on severity filter configuration
	 */
	private getFilteredIssues(): QualityIssue[] {
		if (!this.analysisResult) {
			return [];
		}

		const severityFilter = QualityConfigManager.getSeverityFilter();

		// If filter is empty, show all issues
		if (severityFilter.length === 0) {
			console.warn('[LLT Quality] Severity filter is empty, showing all issues');
			return this.analysisResult.issues;
		}

		return this.analysisResult.issues.filter(issue =>
			severityFilter.includes(issue.severity)
		);
	}

	/**
	 * Get root level items (summary + files)
	 */
	private getRootItems(): QualityTreeItem[] {
		const items: QualityTreeItem[] = [];

		// Add summary item
		items.push(this.createSummaryItem());

		// Group issues by file (with severity filtering)
		const fileMap = this.groupIssuesByFile();

		// Add file items
		for (const [filePath, issues] of fileMap.entries()) {
			items.push(this.createFileItem(filePath, issues));
		}

		return items;
	}

	/**
	 * Create summary item
	 */
	private createSummaryItem(): QualityTreeItem {
		const summary = this.analysisResult!.summary;

		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`**Test Quality Overview**\n\n`);
		tooltip.appendMarkdown(`- Total Files: ${summary.total_files}\n`);
		tooltip.appendMarkdown(`- Issues Found: ${summary.total_issues}\n`);
		tooltip.appendMarkdown(`- Critical Issues: ${summary.critical_issues}\n`);

		return {
			type: TreeItemType.Summary,
			label: '📊 Test Quality Overview',
			description: `${summary.total_issues} ${summary.total_issues === 1 ? 'issue' : 'issues'} found`,
			tooltip: tooltip,
			collapsibleState: vscode.TreeItemCollapsibleState.None,
			contextValue: 'summary'
		};
	}

	/**
	 * Create file item
	 */
	private createFileItem(filePath: string, issues: QualityIssue[]): QualityTreeItem {
		const fileName = filePath.split('/').pop() || filePath;

		const criticalCount = issues.filter(
			i => i.severity === 'error'
		).length;

		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`**${filePath}**\n\n`);
		tooltip.appendMarkdown(`- Total Issues: ${issues.length}\n`);
		tooltip.appendMarkdown(`- Critical: ${criticalCount}\n`);

		return {
			type: TreeItemType.File,
			label: fileName,
			description: `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`,
			tooltip: tooltip,
			collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
			contextValue: 'file',
			filePath: filePath,
			issueCount: issues.length,
			iconPath: new vscode.ThemeIcon('file-code')
		};
	}

	/**
	 * Create issue item
	 */
	private createIssueItem(issue: QualityIssue): QualityTreeItem {
		const icon = this.getIconForSeverity(issue.severity);
		const label = `Line ${issue.line}: ${this.formatIssueType(issue.code)}`;

		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`**${this.formatIssueType(issue.code)}**\n\n`);
		tooltip.appendMarkdown(`${issue.message}\n\n`);
		tooltip.appendMarkdown(`*Detected by: ${issue.detected_by === 'llm' ? '🤖 AI' : '⚡ Rule Engine'}*\n\n`);
		if (issue.suggestion && issue.suggestion.explanation) {
			tooltip.appendMarkdown(`**Suggestion:** ${issue.suggestion.explanation}\n`);
		}

		return {
			type: TreeItemType.Issue,
			label: label,
			description: issue.detected_by === 'llm' ? '🤖 AI' : '⚡ Rule',
			tooltip: tooltip,
			collapsibleState: vscode.TreeItemCollapsibleState.None,
			contextValue: 'issue',
			issue: issue,
			iconPath: icon,
			command: {
				command: 'llt-assistant.showIssue',
				title: 'Show Issue',
				arguments: [issue]
			}
		};
	}

	/**
	 * Get icon for severity level
	 */
	private getIconForSeverity(severity: IssueSeverity): vscode.ThemeIcon {
		switch (severity) {
			case 'error':
				return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
			case 'warning':
				return new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
			case 'info':
				return new vscode.ThemeIcon('info', new vscode.ThemeColor('editorInfo.foreground'));
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

	/**
	 * Group issues by file (with severity filtering applied)
	 */
	private groupIssuesByFile(): Map<string, QualityIssue[]> {
		const fileMap = new Map<string, QualityIssue[]>();
		const filteredIssues = this.getFilteredIssues();

		for (const issue of filteredIssues) {
			// Use file_path field (backend API contract)
			const filePath = issue.file_path;

			const issues = fileMap.get(filePath);
			if (issues) {
				issues.push(issue);
			} else {
				fileMap.set(filePath, [issue]);
			}
		}

		return fileMap;
	}

	/**
	 * Get issues for a specific file (with severity filtering applied)
	 */
	private getIssuesForFile(filePath: string): QualityTreeItem[] {
		const filteredIssues = this.getFilteredIssues();
		const issues = filteredIssues.filter(i => i.file_path === filePath);

		// Sort by line number
		issues.sort((a, b) => a.line - b.line);

		return issues.map(issue => this.createIssueItem(issue));
	}

	/**
	 * Create empty state item
	 */
	private createEmptyStateItem(): QualityTreeItem {
		return {
			type: TreeItemType.Empty,
			label: '🔍 No analysis run yet',
			description: 'Click "Analyze Tests" to start',
			collapsibleState: vscode.TreeItemCollapsibleState.None,
			contextValue: 'empty'
		};
	}

	/**
	 * Get current analysis result
	 */
	public getAnalysisResult(): AnalyzeQualityResponse | null {
		return this.analysisResult;
	}
}
