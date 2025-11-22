/**
 * Coverage Tree Data Provider
 * Manages the tree view in the Activity Bar for coverage analysis
 */

import * as vscode from 'vscode';
import { CoverageReport, CoverageFileData } from '../api/types';
import { CoverageTreeItem, CoverageTreeItemData, CoverageTreeItemType } from './types';

export class CoverageTreeDataProvider implements vscode.TreeDataProvider<CoverageTreeItemData> {
	private _onDidChangeTreeData: vscode.EventEmitter<CoverageTreeItemData | undefined | void> =
		new vscode.EventEmitter<CoverageTreeItemData | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<CoverageTreeItemData | undefined | void> =
		this._onDidChangeTreeData.event;

	private coverageReport: CoverageReport | null = null;

	constructor() {}

	/**
	 * Update the coverage report and refresh the tree view
	 */
	updateCoverageReport(report: CoverageReport | null): void {
		this.coverageReport = report;
		this._onDidChangeTreeData.fire();
	}

	/**
	 * Refresh the tree view
	 */
	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	/**
	 * Clear all coverage data
	 */
	clear(): void {
		this.coverageReport = null;
		this._onDidChangeTreeData.fire();
	}

	/**
	 * Get tree item for a given element
	 */
	getTreeItem(element: CoverageTreeItemData): vscode.TreeItem {
		return new CoverageTreeItem(element, element.collapsibleState);
	}

	/**
	 * Get children for a given element
	 */
	getChildren(element?: CoverageTreeItemData): Thenable<CoverageTreeItemData[]> {
		if (!this.coverageReport) {
			return Promise.resolve([this.createEmptyItem()]);
		}

		if (!element) {
			// Root level: show summary
			return Promise.resolve([this.createSummaryItem()]);
		}

		switch (element.type) {
			case CoverageTreeItemType.Summary:
				return Promise.resolve(this.getFileItems());

			case CoverageTreeItemType.File:
				return Promise.resolve(this.getFunctionItems(element.fileData!));

			case CoverageTreeItemType.PartiallyCoveredFunction:
				return Promise.resolve(this.getBranchItems(element));

			default:
				return Promise.resolve([]);
		}
	}

	/**
	 * Create empty state item
	 */
	private createEmptyItem(): CoverageTreeItemData {
		return {
			type: CoverageTreeItemType.Empty,
			label: 'No coverage data',
			description: 'Run "Analyze Coverage" to start',
			iconPath: new vscode.ThemeIcon('info'),
			contextValue: 'empty'
		};
	}

	/**
	 * Create summary item (root node)
	 */
	private createSummaryItem(): CoverageTreeItemData {
		const report = this.coverageReport!;
		const stats = report.overallStats;

		const totalUncovered = report.files.reduce(
			(sum, f) => sum + f.uncoveredFunctions.length,
			0
		);
		const totalPartial = report.files.reduce(
			(sum, f) => sum + f.partiallyCoveredFunctions.length,
			0
		);

		const lineCoveragePercent = (stats.lineCoverage * 100).toFixed(1);
		const branchCoveragePercent = (stats.branchCoverage * 100).toFixed(1);

		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`**Coverage Analysis**\n\n`);
		tooltip.appendMarkdown(`📊 Line Coverage: ${lineCoveragePercent}%\n\n`);
		tooltip.appendMarkdown(`🔀 Branch Coverage: ${branchCoveragePercent}%\n\n`);
		tooltip.appendMarkdown(`📁 Files: ${report.files.length}\n\n`);
		tooltip.appendMarkdown(`❌ Uncovered Functions: ${totalUncovered}\n\n`);
		tooltip.appendMarkdown(`⚠️ Partially Covered: ${totalPartial}\n\n`);

		return {
			type: CoverageTreeItemType.Summary,
			label: `Coverage: ${lineCoveragePercent}% line, ${branchCoveragePercent}% branch`,
			description: `${report.files.length} files`,
			tooltip,
			iconPath: new vscode.ThemeIcon('graph'),
			collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
			contextValue: 'summary',
			stats: {
				lineCoverage: stats.lineCoverage,
				branchCoverage: stats.branchCoverage,
				totalFiles: report.files.length,
				uncoveredFunctions: totalUncovered,
				partiallyCoveredFunctions: totalPartial
			}
		};
	}

	/**
	 * Get file-level items
	 */
	private getFileItems(): CoverageTreeItemData[] {
		const report = this.coverageReport!;

		// Filter files that have coverage issues
		const filesWithIssues = report.files.filter(
			f =>
				f.uncoveredFunctions.length > 0 ||
				f.partiallyCoveredFunctions.length > 0 ||
				f.lineCoverage < 1.0
		);

		// Sort by coverage (lowest first)
		const sorted = filesWithIssues.sort((a, b) => a.lineCoverage - b.lineCoverage);

		return sorted.map(fileData => {
			const coveragePercent = (fileData.lineCoverage * 100).toFixed(1);
			const issueCount =
				fileData.uncoveredFunctions.length + fileData.partiallyCoveredFunctions.length;

			const tooltip = new vscode.MarkdownString();
			tooltip.appendMarkdown(`**${fileData.filePath}**\n\n`);
			tooltip.appendMarkdown(`Coverage: ${coveragePercent}%\n\n`);
			tooltip.appendMarkdown(`Uncovered Functions: ${fileData.uncoveredFunctions.length}\n\n`);
			tooltip.appendMarkdown(
				`Partially Covered: ${fileData.partiallyCoveredFunctions.length}\n\n`
			);

			// Choose icon based on coverage level
			let icon: vscode.ThemeIcon;
			if (fileData.lineCoverage < 0.5) {
				icon = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
			} else if (fileData.lineCoverage < 0.8) {
				icon = new vscode.ThemeIcon('warning', new vscode.ThemeColor('warningForeground'));
			} else {
				icon = new vscode.ThemeIcon('file-code');
			}

			return {
				type: CoverageTreeItemType.File,
				label: fileData.filePath.split('/').pop() || fileData.filePath,
				description: `${coveragePercent}% (${issueCount} issues)`,
				tooltip,
				iconPath: icon,
				collapsibleState:
					issueCount > 0
						? vscode.TreeItemCollapsibleState.Collapsed
						: vscode.TreeItemCollapsibleState.None,
				contextValue: 'file',
				fileData,
				command:
					issueCount > 0
						? undefined
						: {
								command: 'vscode.open',
								title: 'Open File',
								arguments: [vscode.Uri.file(fileData.filePath)]
						  }
			};
		});
	}

	/**
	 * Get function-level items for a file
	 */
	private getFunctionItems(fileData: CoverageFileData): CoverageTreeItemData[] {
		const items: CoverageTreeItemData[] = [];

		// Add uncovered functions
		for (const func of fileData.uncoveredFunctions) {
			const tooltip = new vscode.MarkdownString();
			tooltip.appendMarkdown(`**Uncovered Function**\n\n`);
			tooltip.appendMarkdown(`Function: \`${func.name}\`\n\n`);
			tooltip.appendMarkdown(`Lines: ${func.startLine}-${func.endLine}\n\n`);
			if (func.complexity) {
				tooltip.appendMarkdown(`Complexity: ${func.complexity}\n\n`);
			}
			tooltip.appendMarkdown(`\n\n⚡️ Generate tests to cover this`);

			items.push({
				type: CoverageTreeItemType.UncoveredFunction,
				label: `⚡️ ${func.name}`,
				description: `Lines ${func.startLine}-${func.endLine}`,
				tooltip,
				iconPath: new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('errorForeground')),
				collapsibleState: vscode.TreeItemCollapsibleState.None,
				contextValue: 'uncovered-function',
				functionData: func,
				filePath: fileData.filePath,
				command: {
					command: 'llt-assistant.generateCoverageTest',
					title: 'Generate tests to cover this',
					arguments: [fileData.filePath, func]
				}
			});
		}

		// Add partially covered functions
		for (const func of fileData.partiallyCoveredFunctions) {
			const tooltip = new vscode.MarkdownString();
			tooltip.appendMarkdown(`**Partially Covered Function**\n\n`);
			tooltip.appendMarkdown(`Function: \`${func.name}\`\n\n`);
			tooltip.appendMarkdown(`Lines: ${func.startLine}-${func.endLine}\n\n`);
			tooltip.appendMarkdown(`Uncovered Branches: ${func.uncoveredBranches.length}\n\n`);
			tooltip.appendMarkdown(`\n\n💡 Expand to see branches`);

			items.push({
				type: CoverageTreeItemType.PartiallyCoveredFunction,
				label: func.name,
				description: `${func.uncoveredBranches.length} branches`,
				tooltip,
				iconPath: new vscode.ThemeIcon('warning', new vscode.ThemeColor('warningForeground')),
				collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
				contextValue: 'partially-covered-function',
				functionData: func,
				filePath: fileData.filePath
			});
		}

		return items;
	}

	/**
	 * Get branch items for a partially covered function
	 */
	private getBranchItems(element: CoverageTreeItemData): CoverageTreeItemData[] {
		const func = element.functionData as any;
		if (!func || !func.uncoveredBranches) {
			return [];
		}

		return func.uncoveredBranches.map((branch: any) => {
			const tooltip = new vscode.MarkdownString();
			tooltip.appendMarkdown(`**Uncovered Branch**\n\n`);
			tooltip.appendMarkdown(`Type: \`${branch.type}\`\n\n`);
			tooltip.appendMarkdown(`Line: ${branch.line}\n\n`);
			tooltip.appendMarkdown(`${branch.description}\n\n`);
			tooltip.appendMarkdown(`\n\n⚡️ Generate tests to cover this`);

			return {
				type: CoverageTreeItemType.Branch,
				label: `⚡️ ${branch.type} - Line ${branch.line}`,
				description: branch.description,
				tooltip,
				iconPath: new vscode.ThemeIcon('git-branch'),
				collapsibleState: vscode.TreeItemCollapsibleState.None,
				contextValue: 'branch',
				branchInfo: branch,
				filePath: element.filePath,
				command: {
					command: 'llt-assistant.generateCoverageTest',
					title: 'Generate tests to cover this',
					arguments: [element.filePath, { startLine: branch.line, endLine: branch.line, type: 'branch' }]
				}
			};
		});
	}
}
