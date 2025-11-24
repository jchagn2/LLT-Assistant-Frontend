/**
 * Decision Dialog
 * Handles user decision about whether functionality changed
 */

import * as vscode from 'vscode';
import { MaintenanceResult, AffectedTestCase, UserDecision } from '../models/types';

/**
 * Decision Dialog Manager
 */
export class DecisionDialogManager {
	/**
	 * Show decision dialog to user
	 * @param result Maintenance analysis result
	 * @returns User decision
	 */
	async showDecisionDialog(result: MaintenanceResult): Promise<UserDecision> {
		// Build summary message
		const filesChanged = result.change_summary.files_changed;
		const testsAffected = result.affected_tests.length;
		const functionsChanged = result.change_summary.functions_changed.length;

		const functionsList = result.change_summary.functions_changed
			.slice(0, 5)
			.map((f: string) => `  • ${f}`)
			.join('\n');
		const moreFunctions =
			functionsChanged > 5 ? `\n  ... and ${functionsChanged - 5} more functions` : '';

		const testsList = result.affected_tests
			.slice(0, 5)
			.map((t: AffectedTestCase) => `  • ${t.test_name} [${t.impact_level.toUpperCase()}]`)
			.join('\n');
		const moreTests = testsAffected > 5 ? `\n  ... and ${testsAffected - 5} more tests` : '';

		const message = `**Code Changes Detected**\n\n` +
			`**Commit:** ${result.commit_hash.substring(0, 7)}\n` +
			`**Files changed:** ${filesChanged}\n` +
			`**Functions changed:** ${functionsChanged}\n` +
			`**Tests affected:** ${testsAffected}\n\n` +
			`**Changed functions:**\n${functionsList}${moreFunctions}\n\n` +
			`**Affected tests:**\n${testsList}${moreTests}\n\n` +
			`---\n\n` +
			`**Has the functionality of these functions changed, or is it just refactoring?**\n\n` +
			`• **Yes, functionality changed** → Will regenerate tests with new functionality\n` +
			`• **No, just refactoring** → Will improve test coverage for existing functionality\n` +
			`• **Cancel** → Skip maintenance for now`;

		// Show modal dialog
		const action = await vscode.window.showInformationMessage(
			message,
			{ modal: true },
			'Yes, functionality changed',
			'No, just refactoring',
			'Cancel'
		);

		if (action === 'Yes, functionality changed') {
			// Ask for user description
			const description = await this.promptForFunctionalityDescription(result);
			if (!description) {
				return { decision: 'cancelled' };
			}

			// Ask which tests to regenerate
			const selectedTests = await this.selectTestsToFix(result.affected_tests, 'regenerate');
			if (!selectedTests || selectedTests.length === 0) {
				return { decision: 'cancelled' };
			}

			return {
				decision: 'functionality_changed',
				user_description: description,
				selected_tests: selectedTests
			};
		} else if (action === 'No, just refactoring') {
			// Ask which tests to improve
			const selectedTests = await this.selectTestsToFix(result.affected_tests, 'improve_coverage');
			if (!selectedTests || selectedTests.length === 0) {
				return { decision: 'cancelled' };
			}

			return {
				decision: 'refactor_only',
				selected_tests: selectedTests
			};
		} else {
			return { decision: 'cancelled' };
		}
	}

	/**
	 * Prompt user for functionality description
	 */
	private async promptForFunctionalityDescription(
		result: MaintenanceResult
	): Promise<string | undefined> {
		const description = await vscode.window.showInputBox({
			prompt: 'Describe the new/changed functionality',
			placeHolder: 'e.g., Added support for negative numbers, Changed return type to include error codes, etc.',
			value: `Updated functionality for: ${result.change_summary.functions_changed.slice(0, 3).join(', ')}`,
			ignoreFocusOut: true
		});

		return description;
	}

	/**
	 * Select tests to fix
	 */
	private async selectTestsToFix(
		tests: AffectedTestCase[],
		action: 'regenerate' | 'improve_coverage'
	): Promise<AffectedTestCase[] | undefined> {
		// Create quick pick items
		const items = tests.map((test, index) => ({
			label: test.test_name,
			description: `${test.test_file} [${test.impact_level.toUpperCase()}]`,
			detail: test.reason,
			picked: test.requires_update, // Pre-select tests that require update
			index,
			test
		}));

		const actionLabel = action === 'regenerate' ? 'regenerate' : 'improve coverage for';
		const selected = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			placeHolder: `Select tests to ${actionLabel} (deselect to skip)`,
			title: `Select Tests to ${action === 'regenerate' ? 'Regenerate' : 'Improve Coverage'} (${tests.length} tests)`
		});

		if (!selected || selected.length === 0) {
			return undefined;
		}

		return selected.map(item => item.test);
	}

	/**
	 * Show diff preview before applying fixes
	 */
	async showDiffPreview(
		filePath: string,
		oldContent: string,
		newContent: string
	): Promise<boolean> {
		const message = `Preview changes for ${filePath}?`;
		const action = await vscode.window.showInformationMessage(
			message,
			'Preview',
			'Apply Directly',
			'Cancel'
		);

		if (action === 'Preview') {
			// Show diff using built-in diff viewer
			// TODO: Implement content provider for diff preview
			// This would require a content provider - simplified for now
			await vscode.window.showInformationMessage('Diff preview would be shown here');
			return true;
		} else if (action === 'Apply Directly') {
			return true;
		} else {
			return false;
		}
	}
}

