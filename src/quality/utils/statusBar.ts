/**
 * Status Bar Manager for Quality Analysis
 */

import * as vscode from 'vscode';

export class QualityStatusBarManager {
	private statusBarItem: vscode.StatusBarItem;

	constructor() {
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			100
		);
		this.statusBarItem.command = 'llt-assistant.analyzeQuality';
		this.showIdle();
		this.statusBarItem.show();
	}

	/**
	 * Show idle state
	 */
	showIdle(): void {
		this.statusBarItem.text = '$(beaker) LLT Quality';
		this.statusBarItem.tooltip = 'Click to analyze test quality';
		this.statusBarItem.backgroundColor = undefined;
	}

	/**
	 * Show analyzing state
	 */
	showAnalyzing(): void {
		this.statusBarItem.text = '$(loading~spin) LLT: Analyzing...';
		this.statusBarItem.tooltip = 'Quality analysis in progress';
		this.statusBarItem.backgroundColor = undefined;
	}

	/**
	 * Show results state
	 */
	showResults(issueCount: number, criticalCount: number): void {
		if (criticalCount > 0) {
			this.statusBarItem.text = `$(error) LLT: ${issueCount} ${issueCount === 1 ? 'issue' : 'issues'}`;
			this.statusBarItem.tooltip = `${criticalCount} critical ${criticalCount === 1 ? 'issue' : 'issues'} found`;
			this.statusBarItem.backgroundColor = new vscode.ThemeColor(
				'statusBarItem.errorBackground'
			);
		} else if (issueCount > 0) {
			this.statusBarItem.text = `$(warning) LLT: ${issueCount} ${issueCount === 1 ? 'issue' : 'issues'}`;
			this.statusBarItem.tooltip = 'Click to view issues';
			this.statusBarItem.backgroundColor = new vscode.ThemeColor(
				'statusBarItem.warningBackground'
			);
		} else {
			this.statusBarItem.text = '$(check) LLT: No issues';
			this.statusBarItem.tooltip = 'All tests look good!';
			this.statusBarItem.backgroundColor = undefined;
		}
	}

	/**
	 * Show error state
	 */
	showError(message: string): void {
		this.statusBarItem.text = '$(error) LLT: Error';
		this.statusBarItem.tooltip = message;
		this.statusBarItem.backgroundColor = new vscode.ThemeColor(
			'statusBarItem.errorBackground'
		);
	}

	/**
	 * Dispose status bar item
	 */
	dispose(): void {
		this.statusBarItem.dispose();
	}
}
