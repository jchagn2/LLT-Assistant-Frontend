/**
 * Impact Analysis Tree View Provider
 * Provides tree view with dual-view support (File→Tests and Tests←Files)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
	ChangeDetectionResult,
	ViewMode,
	FileToTestsMapping,
	TestToFilesMapping,
	AffectedTest,
	FunctionChange,
	ImpactTreeItemType,
	FileToTestsMetadata,
	TestsToFilesMetadata
} from '../models/types';

/**
 * Tree item with metadata
 */
export class ImpactTreeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly itemType: ImpactTreeItemType,
		public readonly metadata?: FileToTestsMetadata | TestsToFilesMetadata | AffectedTest | FunctionChange
	) {
		super(label, collapsibleState);
		this.contextValue = itemType;
	}
}

/**
 * Impact Tree Data Provider
 */
export class ImpactTreeProvider implements vscode.TreeDataProvider<ImpactTreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<ImpactTreeItem | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private data: ChangeDetectionResult | null = null;
	private viewMode: ViewMode = 'file-to-tests';

	/**
	 * Refresh tree view with new data
	 */
	refresh(data: ChangeDetectionResult): void {
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
	 * Switch view mode
	 */
	switchView(mode: ViewMode): void {
		this.viewMode = mode;
		this._onDidChangeTreeData.fire();
	}

	/**
	 * Get current view mode
	 */
	getCurrentViewMode(): ViewMode {
		return this.viewMode;
	}

	/**
	 * Get analysis result
	 */
	getAnalysisResult(): ChangeDetectionResult | null {
		return this.data;
	}

	/**
	 * Get tree item
	 */
	getTreeItem(element: ImpactTreeItem): vscode.TreeItem {
		return element;
	}

	/**
	 * Get children
	 */
	async getChildren(element?: ImpactTreeItem): Promise<ImpactTreeItem[]> {
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
	private createEmptyItem(): ImpactTreeItem {
		const item = new ImpactTreeItem(
			'No changes detected',
			vscode.TreeItemCollapsibleState.None,
			ImpactTreeItemType.Empty
		);
		item.description = 'Click "Analyze Changes" to scan for changes';
		item.iconPath = new vscode.ThemeIcon('info');
		return item;
	}

	/**
	 * Get root level items
	 */
	private getRootItems(): ImpactTreeItem[] {
		if (!this.data) {
			return [];
		}

		const items: ImpactTreeItem[] = [];

		// Add summary
		items.push(this.createSummaryItem());

		// Add view-specific items
		if (this.viewMode === 'file-to-tests') {
			items.push(...this.getFileToTestsRootItems());
		} else {
			items.push(...this.getTestsToFilesRootItems());
		}

		return items;
	}

	/**
	 * Create summary item
	 */
	private createSummaryItem(): ImpactTreeItem {
		if (!this.data) {
			return new ImpactTreeItem(
				'Summary',
				vscode.TreeItemCollapsibleState.Collapsed,
				ImpactTreeItemType.Summary
			);
		}

		const filesChanged = this.data.change_summary.files_changed_count;
		const testsAffected = this.data.affected_tests.length;
		const linesAdded = this.data.change_summary.lines_added;
		const linesRemoved = this.data.change_summary.lines_removed;

		const item = new ImpactTreeItem(
			'📊 Summary',
			vscode.TreeItemCollapsibleState.Expanded,
			ImpactTreeItemType.Summary
		);

		item.description = `${filesChanged} files, ${testsAffected} tests affected`;
		item.tooltip = new vscode.MarkdownString(
			`**Summary**\n\n` +
			`- Files changed: ${filesChanged}\n` +
			`- Tests affected: ${testsAffected}\n` +
			`- Lines added: +${linesAdded}\n` +
			`- Lines removed: -${linesRemoved}\n` +
			`- Change type: ${this.data.change_summary.change_type}`
		);

		return item;
	}

	/**
	 * Get root items for File→Tests view
	 */
	private getFileToTestsRootItems(): ImpactTreeItem[] {
		if (!this.data) {
			return [];
		}

		const mapping = this.buildFileToTestsMapping();
		const items: ImpactTreeItem[] = [];

		for (const [filePath, data] of Object.entries(mapping)) {
			const item = new ImpactTreeItem(
				path.basename(filePath),
				vscode.TreeItemCollapsibleState.Expanded,
				ImpactTreeItemType.SourceFile,
				data
			);

			item.description = `${data.functions.length} functions modified`;
			item.iconPath = new vscode.ThemeIcon('file-code');
			item.resourceUri = vscode.Uri.file(filePath);

			// Click to open file
			item.command = {
				command: 'vscode.open',
				arguments: [vscode.Uri.file(filePath)],
				title: 'Open File'
			};

			items.push(item);
		}

		return items;
	}

	/**
	 * Get root items for Tests←Files view
	 */
	private getTestsToFilesRootItems(): ImpactTreeItem[] {
		if (!this.data) {
			return [];
		}

		const mapping = this.buildTestToFilesMapping();
		const items: ImpactTreeItem[] = [];

		for (const [testPath, data] of Object.entries(mapping)) {
			const item = new ImpactTreeItem(
				path.basename(testPath),
				vscode.TreeItemCollapsibleState.Expanded,
				ImpactTreeItemType.TestFile,
				data
			);

			item.description = `${data.tests.length} tests affected`;
			item.iconPath = new vscode.ThemeIcon('beaker');
			item.resourceUri = vscode.Uri.file(testPath);

			items.push(item);
		}

		return items;
	}

	/**
	 * Get child items
	 */
	private getChildItems(parent: ImpactTreeItem): ImpactTreeItem[] {
		if (parent.itemType === ImpactTreeItemType.Summary) {
			return this.getSummaryChildren();
		}

		// Handle Files Changed Group expansion
		if (parent.itemType === ImpactTreeItemType.FilesChangedGroup) {
			return this.getFilesChangedChildren();
		}

		// Handle Tests Affected Group expansion
		if (parent.itemType === ImpactTreeItemType.TestsAffectedGroup) {
			return this.getTestsAffectedChildren();
		}

		if (this.viewMode === 'file-to-tests') {
			return this.getFileToTestsChildren(parent);
		} else {
			return this.getTestsToFilesChildren(parent);
		}
	}

	/**
	 * Get children for Files Changed Group
	 * Shows all changed files with click-to-open functionality
	 */
	private getFilesChangedChildren(): ImpactTreeItem[] {
		if (!this.data) {
			return [];
		}

		const items: ImpactTreeItem[] = [];
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

		if (!workspaceRoot) {
			return items;
		}

		// Group files by directory for better organization
		const filesByDir = new Map<string, string[]>();

		for (const filePath of this.data.changed_files) {
			const dirPath = path.dirname(filePath);
			if (!filesByDir.has(dirPath)) {
				filesByDir.set(dirPath, []);
			}
			filesByDir.get(dirPath)!.push(filePath);
		}

		// Create items for each changed file
		for (const filePath of this.data.changed_files.sort()) {
			const fileName = path.basename(filePath);
			const dirName = path.dirname(filePath);

			const item = new ImpactTreeItem(
				fileName,
				vscode.TreeItemCollapsibleState.None,
				ImpactTreeItemType.SourceFile
			);

			item.description = dirName === '.' ? '' : dirName;
			item.iconPath = new vscode.ThemeIcon('file-code', new vscode.ThemeColor('charts.green'));
			item.tooltip = new vscode.MarkdownString(
				`**Modified File**\n\n` +
				`Path: \`${filePath}\`\n\n` +
				`Click to open this file`
			);

			// Add click command to open file
			const fullPath = path.join(workspaceRoot, filePath);
			item.command = {
				command: 'vscode.open',
				arguments: [vscode.Uri.file(fullPath)],
				title: 'Open File'
			};
			item.resourceUri = vscode.Uri.file(fullPath);

			items.push(item);
		}

		return items;
	}

	/**
	 * Get children for Tests Affected Group
	 * Shows all affected tests with click-to-jump functionality
	 */
	private getTestsAffectedChildren(): ImpactTreeItem[] {
		if (!this.data) {
			return [];
		}

		const items: ImpactTreeItem[] = [];

		// Group tests by file for better organization
		const testsByFile = new Map<string, AffectedTest[]>();

		for (const test of this.data.affected_tests) {
			if (!testsByFile.has(test.file_path)) {
				testsByFile.set(test.file_path, []);
			}
			testsByFile.get(test.file_path)!.push(test);
		}

		// Create items grouped by test file
		const sortedFiles = Array.from(testsByFile.keys()).sort();

		for (const filePath of sortedFiles) {
			const tests = testsByFile.get(filePath)!;

			// If only one test in file, show it directly
			if (tests.length === 1) {
				items.push(this.createTestItem(tests[0]));
			} else {
				// Multiple tests in same file - create a group
				const fileName = path.basename(filePath);

				// Prepare metadata
				const testFileMetadata: TestsToFilesMetadata = {
					tests: tests,
					impacted_by: []
				};

				const groupItem = new ImpactTreeItem(
					fileName,
					vscode.TreeItemCollapsibleState.Collapsed,
					ImpactTreeItemType.TestFile,
					testFileMetadata  // Pass as constructor parameter
				);

				groupItem.description = `${tests.length} tests`;
				groupItem.iconPath = new vscode.ThemeIcon('beaker', new vscode.ThemeColor('charts.orange'));
				groupItem.tooltip = new vscode.MarkdownString(
					`**Test File: ${fileName}**\n\n` +
					`${tests.length} affected tests in this file`
				);

				items.push(groupItem);
			}
		}

		return items;
	}

	/**
	 * Get summary children
	 *
	 * Shows three expandable/clickable items:
	 * 1. Files changed - Click to expand and see all modified source files
	 * 2. Tests affected - Click to expand and see all impacted test files
	 * 3. Lines changed - Summary of code additions/deletions (informational only)
	 */
	private getSummaryChildren(): ImpactTreeItem[] {
		if (!this.data) {
			return [];
		}

		const items: ImpactTreeItem[] = [];

		// Files changed - Expandable to show all changed files
		const filesCount = this.data.change_summary.files_changed_count;
		const filesItem = new ImpactTreeItem(
			`📝 ${filesCount} ${filesCount === 1 ? 'file' : 'files'} changed`,
			filesCount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
			ImpactTreeItemType.FilesChangedGroup
		);
		filesItem.tooltip = new vscode.MarkdownString(
			`**Files Changed: ${filesCount}**\n\n` +
			`Source files that have been modified.\n\n` +
			`Click to expand and view all changed files.`
		);
		items.push(filesItem);

		// Tests affected - Expandable to show all affected tests
		const testsCount = this.data.affected_tests.length;
		const testsItem = new ImpactTreeItem(
			`🧪 ${testsCount} ${testsCount === 1 ? 'test' : 'tests'} affected`,
			testsCount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
			ImpactTreeItemType.TestsAffectedGroup
		);
		testsItem.tooltip = new vscode.MarkdownString(
			`**Tests Affected: ${testsCount}**\n\n` +
			`Tests that may need to be updated due to code changes.\n\n` +
			`Click to expand and view all affected tests.`
		);
		items.push(testsItem);

		// Lines changed - Informational summary (not expandable)
		const linesAdded = this.data.change_summary.lines_added;
		const linesRemoved = this.data.change_summary.lines_removed;
		const linesItem = new ImpactTreeItem(
			`📏 +${linesAdded} / -${linesRemoved} lines`,
			vscode.TreeItemCollapsibleState.None,
			ImpactTreeItemType.Summary
		);
		linesItem.tooltip = new vscode.MarkdownString(
			`**Lines Changed**\n\n` +
			`- Added: +${linesAdded} lines\n` +
			`- Removed: -${linesRemoved} lines\n` +
			`- Net change: ${linesAdded - linesRemoved > 0 ? '+' : ''}${linesAdded - linesRemoved} lines`
		);
		items.push(linesItem);

		return items;
	}

	/**
	 * Get children for File→Tests view
	 */
	private getFileToTestsChildren(parent: ImpactTreeItem): ImpactTreeItem[] {
		const items: ImpactTreeItem[] = [];

		if (parent.itemType === ImpactTreeItemType.SourceFile) {
			const metadata = parent.metadata as FileToTestsMetadata;

			// Add function items
			for (const func of metadata.functions) {
				const funcItem = new ImpactTreeItem(
					`⚡ ${func.function_name}`,
					vscode.TreeItemCollapsibleState.None,
					ImpactTreeItemType.Function,
					func
				);
				funcItem.description = `modified, lines ${func.line_range[0]}-${func.line_range[1]}`;
				funcItem.tooltip = func.change_description;
				items.push(funcItem);
			}

			// Add affected tests group
			if (metadata.affected_tests.length > 0) {
				const groupItem = new ImpactTreeItem(
					`💥 Affects ${metadata.affected_tests.length} tests`,
					vscode.TreeItemCollapsibleState.Expanded,
					ImpactTreeItemType.AffectedTestsGroup,
					metadata
				);
				items.push(groupItem);
			}
		} else if (parent.itemType === ImpactTreeItemType.AffectedTestsGroup) {
			const metadata = parent.metadata as FileToTestsMetadata;

			// Group tests by file
			const testsByFile = new Map<string, AffectedTest[]>();
			for (const test of metadata.affected_tests) {
				if (!testsByFile.has(test.file_path)) {
					testsByFile.set(test.file_path, []);
				}
				testsByFile.get(test.file_path)!.push(test);
			}

			// Create items for each test file
			for (const tests of testsByFile.values()) {
				for (const test of tests) {
					const testItem = this.createTestItem(test);
					items.push(testItem);
				}
			}
		}

		return items;
	}

	/**
	 * Get children for Tests←Files view
	 */
	private getTestsToFilesChildren(parent: ImpactTreeItem): ImpactTreeItem[] {
		const items: ImpactTreeItem[] = [];

		if (parent.itemType === ImpactTreeItemType.TestFile) {
			const metadata = parent.metadata as TestsToFilesMetadata;

			// Add test items
			for (const test of metadata.tests) {
				const testItem = this.createTestItem(test);
				items.push(testItem);
			}

			// Add impacted by group only if we have function changes
			if (metadata.impacted_by && metadata.impacted_by.length > 0) {
				const groupItem = new ImpactTreeItem(
					`📌 Impacted by ${metadata.impacted_by.length} changes`,
					vscode.TreeItemCollapsibleState.Expanded,
					ImpactTreeItemType.ImpactedByGroup,
					metadata
				);
				items.push(groupItem);
			}
		} else if (parent.itemType === ImpactTreeItemType.ImpactedByGroup) {
			const metadata = parent.metadata as TestsToFilesMetadata;

			// Create items for each source change
			for (const func of metadata.impacted_by) {
				const funcItem = new ImpactTreeItem(
					`${path.basename(func.file_path)} → ${func.function_name}`,
					vscode.TreeItemCollapsibleState.None,
					ImpactTreeItemType.Function,
					func
				);
				funcItem.description = 'modified';
				funcItem.tooltip = func.change_description;
				funcItem.iconPath = new vscode.ThemeIcon('symbol-function');

				// Click to jump to source
				const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
				if (workspaceRoot) {
					const fullPath = path.join(workspaceRoot, func.file_path);
					funcItem.command = {
						command: 'llt-assistant.goToLine',
						arguments: [fullPath, func.line_range[0]],
						title: 'Go to Function'
					};
				}

				items.push(funcItem);
			}
		}

		return items;
	}

	/**
	 * Create a test item
	 */
	private createTestItem(test: AffectedTest): ImpactTreeItem {
		const severityIcon = this.getSeverityIcon(test.impact_level);

		const item = new ImpactTreeItem(
			`${severityIcon} ${test.test_name}`,
			vscode.TreeItemCollapsibleState.None,
			ImpactTreeItemType.Test,
			test
		);

		item.description = test.impact_level.toUpperCase();
		item.tooltip = new vscode.MarkdownString(
			`**Impact:** ${test.impact_level}\n\n` +
			`**Reason:** ${test.reason}\n\n` +
			`**Requires update:** ${test.requires_update ? 'Yes' : 'No'}\n\n` +
			`Click to jump to test`
		);

		// Click to navigate to test
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
		if (workspaceRoot && test.line_number) {
			const fullPath = path.join(workspaceRoot, test.file_path);
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
	private getSeverityIcon(level: string): string {
		const icons: { [key: string]: string } = {
			critical: '🔴',
			high: '🟠',
			medium: '🟡',
			low: '🔵'
		};
		return icons[level] || '⚪';
	}

	/**
	 * Find the best matching source file for a test
	 * Uses naming conventions to match test files to source files
	 */
	private findBestMatchingSourceFile(test: AffectedTest, sourceFiles: string[]): string | null {
		// Infer expected source file from test file
		// tests/test_calculator.py -> calculator.py or src/calculator.py
		const testFileName = test.file_path.split('/').pop() || '';
		const expectedSourceFileName = testFileName.replace(/^test_/, '');

		// Priority 1: Exact file name match
		for (const sourcePath of sourceFiles) {
			const sourceFileName = sourcePath.split('/').pop() || '';
			if (sourceFileName === expectedSourceFileName) {
				return sourcePath;
			}
		}

		// Priority 2: Match without extension
		const testFileBaseName = expectedSourceFileName.replace(/\.py$/, '');
		for (const sourcePath of sourceFiles) {
			const sourceFileName = sourcePath.split('/').pop() || '';
			const sourceFileBaseName = sourceFileName.replace(/\.py$/, '');
			if (sourceFileBaseName === testFileBaseName) {
				return sourcePath;
			}
		}

		// No match found
		return null;
	}

	/**
	 * Build File→Tests mapping
	 */
	private buildFileToTestsMapping(): FileToTestsMapping {
		if (!this.data) {
			return {};
		}

		const mapping: FileToTestsMapping = {};

		// Group functions by file
		for (const func of this.data.change_summary.functions_changed) {
			if (!mapping[func.file_path]) {
				mapping[func.file_path] = {
					functions: [],
					affected_tests: []
				};
			}
			mapping[func.file_path].functions.push(func);
		}

		// Add affected tests to corresponding files with smart matching
		for (const test of this.data.affected_tests) {
			// Find which source file this test is most likely related to
			const matchedFilePath = this.findBestMatchingSourceFile(test, Object.keys(mapping));

			if (matchedFilePath && mapping[matchedFilePath]) {
				mapping[matchedFilePath].affected_tests.push(test);
			} else {
				// Fallback: if no good match found, add to all files (legacy behavior)
				// This ensures we don't lose tests in the UI
				for (const filePath of Object.keys(mapping)) {
					mapping[filePath].affected_tests.push(test);
				}
			}
		}

		return mapping;
	}

	/**
	 * Build Tests←Files mapping
	 */
	private buildTestToFilesMapping(): TestToFilesMapping {
		if (!this.data) {
			return {};
		}

		const mapping: TestToFilesMapping = {};

		// Group tests by test file
		for (const test of this.data.affected_tests) {
			if (!mapping[test.file_path]) {
				mapping[test.file_path] = {
					tests: [],
					impacted_by: []
				};
			}
			mapping[test.file_path].tests.push(test);

			// Add all function changes as impacting this test
			mapping[test.file_path].impacted_by = this.data.change_summary.functions_changed;
		}

		return mapping;
	}
}
