/**
 * Maintenance Tree View Provider
 * Provides tree view for displaying affected test cases
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { MaintenanceResult, AffectedTestCase, MaintenanceImpactLevel } from '../models/types';

/**
 * Tree item type
 */
export enum MaintenanceTreeItemType {
	Summary = 'summary',
	TestFile = 'testFile',
	TestCase = 'testCase',
	Empty = 'empty'
}

/**
 * Tree item with metadata
 */
export class MaintenanceTreeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly itemType: MaintenanceTreeItemType,
		public readonly metadata?: AffectedTestCase | MaintenanceResult
	) {
		super(label, collapsibleState);
		this.contextValue = itemType;
	}
}

/**
 * Maintenance Tree Data Provider
 */
export class MaintenanceTreeProvider implements vscode.TreeDataProvider<MaintenanceTreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<MaintenanceTreeItem | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private data: MaintenanceResult | null = null;

	/**
	 * Refresh tree view with new data
	 */
	refresh(data: MaintenanceResult): void {
		this.data = data;
		this._onDidChangeTreeData.fire();
	}

	/**
	 * Clear tree view
	 */
	clear(): void {
		this.data = null;
		this._onDidChangeTreeData.fire();
	}

	/**
	 * Get analysis result
	 */
	getAnalysisResult(): MaintenanceResult | null {
		return this.data;
	}

	/**
	 * Get tree item
	 */
	getTreeItem(element: MaintenanceTreeItem): vscode.TreeItem {
		return element;
	}

	/**
	 * Get children
	 */
	async getChildren(element?: MaintenanceTreeItem): Promise<MaintenanceTreeItem[]> {
		if (!this.data) {
			return [this.createEmptyItem()];
		}

		// Root level
		if (!element) {
			return this.getRootItems();
		}

		// Child items
		return this.getChildItems(element);
	}

	/**
	 * Create empty state item
	 */
	private createEmptyItem(): MaintenanceTreeItem {
		const item = new MaintenanceTreeItem(
			'No maintenance analysis available',
			vscode.TreeItemCollapsibleState.None,
			MaintenanceTreeItemType.Empty
		);
		item.description = 'Click "Analyze Maintenance" to start';
		item.iconPath = new vscode.ThemeIcon('info');
		return item;
	}

	/**
	 * Get root level items
	 */
	private getRootItems(): MaintenanceTreeItem[] {
		if (!this.data) {
			return [];
		}

		const items: MaintenanceTreeItem[] = [];

		// Add summary
		items.push(this.createSummaryItem());

		// Group tests by file
		const testsByFile = this.groupTestsByFile(this.data.affected_tests);

		// Add test file items
		for (const [testFile, tests] of testsByFile.entries()) {
			const item = new MaintenanceTreeItem(
				path.basename(testFile),
				vscode.TreeItemCollapsibleState.Expanded,
				MaintenanceTreeItemType.TestFile,
				this.data
			);

			item.description = `${tests.length} test(s) affected`;
			item.iconPath = new vscode.ThemeIcon('beaker');
			item.resourceUri = vscode.Uri.file(testFile);
			item.tooltip = new vscode.MarkdownString(`**Test File:** ${testFile}\n\n**Affected Tests:** ${tests.length}`);

			// Click to open file
			item.command = {
				command: 'vscode.open',
				arguments: [vscode.Uri.file(testFile)],
				title: 'Open Test File'
			};

			items.push(item);
		}

		return items;
	}

	/**
	 * Get child items
	 */
	private getChildItems(parent: MaintenanceTreeItem): MaintenanceTreeItem[] {
		const items: MaintenanceTreeItem[] = [];

		if (parent.itemType === MaintenanceTreeItemType.Summary) {
			return this.getSummaryChildren();
		}

		if (parent.itemType === MaintenanceTreeItemType.TestFile) {
			// Get tests for this file
			const testFile = parent.resourceUri?.fsPath;
			if (testFile && this.data) {
				const tests = this.data.affected_tests.filter((t: AffectedTestCase) => t.test_file === testFile);
				for (const test of tests) {
					items.push(this.createTestCaseItem(test));
				}
			}
		}

		return items;
	}

	/**
	 * Create summary item
	 */
	private createSummaryItem(): MaintenanceTreeItem {
		if (!this.data) {
			return new MaintenanceTreeItem(
				'Summary',
				vscode.TreeItemCollapsibleState.Collapsed,
				MaintenanceTreeItemType.Summary
			);
		}

		const testsAffected = this.data.affected_tests.length;
		const filesChanged = this.data.change_summary.files_changed;
		const linesAdded = this.data.change_summary.lines_added;
		const linesRemoved = this.data.change_summary.lines_removed;

		const item = new MaintenanceTreeItem(
			'📊 Summary',
			vscode.TreeItemCollapsibleState.Expanded,
			MaintenanceTreeItemType.Summary,
			this.data
		);

		item.description = `${filesChanged} files, ${testsAffected} tests affected`;
		item.tooltip = new vscode.MarkdownString(
			`**Summary**\n\n` +
			`- Files changed: ${filesChanged}\n` +
			`- Tests affected: ${testsAffected}\n` +
			`- Lines added: +${linesAdded}\n` +
			`- Lines removed: -${linesRemoved}\n` +
			`- Change type: ${this.data.change_summary.change_type}\n` +
			`- Commit: ${this.data.commit_hash.substring(0, 7)}`
		);

		return item;
	}

	/**
	 * Get summary children
	 */
	private getSummaryChildren(): MaintenanceTreeItem[] {
		if (!this.data) {
			return [];
		}

		const items: MaintenanceTreeItem[] = [];

		// Files changed
		const filesItem = new MaintenanceTreeItem(
			`📝 ${this.data.change_summary.files_changed} files changed`,
			vscode.TreeItemCollapsibleState.None,
			MaintenanceTreeItemType.Summary
		);
		items.push(filesItem);

		// Tests affected
		const testsItem = new MaintenanceTreeItem(
			`🧪 ${this.data.affected_tests.length} tests affected`,
			vscode.TreeItemCollapsibleState.None,
			MaintenanceTreeItemType.Summary
		);
		items.push(testsItem);

		// Lines changed
		const linesItem = new MaintenanceTreeItem(
			`📏 +${this.data.change_summary.lines_added} / -${this.data.change_summary.lines_removed} lines`,
			vscode.TreeItemCollapsibleState.None,
			MaintenanceTreeItemType.Summary
		);
		items.push(linesItem);

		// Change type
		const changeTypeItem = new MaintenanceTreeItem(
			`🔄 Change type: ${this.data.change_summary.change_type}`,
			vscode.TreeItemCollapsibleState.None,
			MaintenanceTreeItemType.Summary
		);
		items.push(changeTypeItem);

		return items;
	}

	/**
	 * Create test case item
	 */
	private createTestCaseItem(test: AffectedTestCase): MaintenanceTreeItem {
		const severityIcon = this.getSeverityIcon(test.impact_level);

		const item = new MaintenanceTreeItem(
			`${severityIcon} ${test.test_name}`,
			vscode.TreeItemCollapsibleState.None,
			MaintenanceTreeItemType.TestCase,
			test
		);

		item.description = test.impact_level.toUpperCase();
		item.tooltip = new vscode.MarkdownString(
			`**Test:** ${test.test_name}\n\n` +
			`**Impact:** ${test.impact_level}\n\n` +
			`**Reason:** ${test.reason}\n\n` +
			`**Requires update:** ${test.requires_update ? 'Yes' : 'No'}\n\n` +
			(test.source_function
				? `**Source function:** ${test.source_function}\n\n`
				: '') +
			`Click to jump to test`
		);

		// Click to navigate to test
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (workspaceRoot && test.line_number) {
			const fullPath = path.join(workspaceRoot, test.test_file);
			item.command = {
				command: 'llt-assistant.goToLine',
				arguments: [fullPath, test.line_number],
				title: 'Jump to Test'
			};
		}

		return item;
	}

	/**
	 * Get severity icon
	 */
	private getSeverityIcon(level: MaintenanceImpactLevel): string {
		const icons: { [key: string]: string } = {
			critical: '🔴',
			high: '🟠',
			medium: '🟡',
			low: '🔵'
		};
		return icons[level] || '⚪';
	}

	/**
	 * Group tests by file
	 */
	private groupTestsByFile(tests: AffectedTestCase[]): Map<string, AffectedTestCase[]> {
		const grouped = new Map<string, AffectedTestCase[]>();

		for (const test of tests) {
			if (!grouped.has(test.test_file)) {
				grouped.set(test.test_file, []);
			}
			grouped.get(test.test_file)!.push(test);
		}

		return grouped;
	}
}

