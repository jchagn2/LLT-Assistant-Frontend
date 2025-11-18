/**
 * Activity Bar Tree View Types
 */

import * as vscode from 'vscode';
import { QualityIssue } from '../api/types';

/**
 * Tree item type
 */
export enum TreeItemType {
	Summary = 'summary',
	File = 'file',
	Issue = 'issue',
	Empty = 'empty'
}

/**
 * Tree item data
 */
export interface QualityTreeItem {
	type: TreeItemType;
	label: string;
	description?: string;
	tooltip?: string | vscode.MarkdownString;
	iconPath?: vscode.ThemeIcon;
	collapsibleState?: vscode.TreeItemCollapsibleState;
	contextValue?: string;
	command?: vscode.Command;

	// For file items
	filePath?: string;
	issueCount?: number;

	// For issue items
	issue?: QualityIssue;
}
