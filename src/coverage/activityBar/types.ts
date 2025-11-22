/**
 * Activity Bar Tree View Types for Coverage Feature
 */

import * as vscode from 'vscode';
import { CoverageFileData, UncoveredFunction, PartiallyCoveredFunction, UncoveredRange } from '../api/types';

/**
 * Tree item type for coverage view
 */
export enum CoverageTreeItemType {
	Summary = 'summary',
	File = 'file',
	UncoveredFunction = 'uncovered-function',
	PartiallyCoveredFunction = 'partially-covered-function',
	Branch = 'branch',
	UncoveredLines = 'uncovered-lines',
	Empty = 'empty'
}

/**
 * Coverage tree item data
 */
export interface CoverageTreeItemData {
	type: CoverageTreeItemType;
	label: string;
	description?: string;
	tooltip?: string | vscode.MarkdownString;
	iconPath?: vscode.ThemeIcon;
	collapsibleState?: vscode.TreeItemCollapsibleState;
	contextValue?: string;
	command?: vscode.Command;

	// For summary items
	stats?: {
		lineCoverage: number;
		branchCoverage: number;
		totalFiles: number;
		uncoveredFunctions: number;
		partiallyCoveredFunctions: number;
	};

	// For file items
	fileData?: CoverageFileData;

	// For function items
	functionData?: UncoveredFunction | PartiallyCoveredFunction;
	filePath?: string;

	// For branch items
	branchInfo?: {
		line: number;
		type: string;
		description: string;
	};

	// For uncovered lines/branches
	uncoveredRanges?: UncoveredRange[];
}

/**
 * Coverage tree item for VSCode tree view
 */
export class CoverageTreeItem extends vscode.TreeItem {
	constructor(
		public readonly data: CoverageTreeItemData,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
	) {
		super(data.label, collapsibleState);

		this.description = data.description;
		this.tooltip = data.tooltip;
		this.iconPath = data.iconPath;
		this.contextValue = data.contextValue;
		this.command = data.command;
	}
}
