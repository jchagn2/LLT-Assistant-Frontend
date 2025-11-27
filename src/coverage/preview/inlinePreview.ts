/**
 * Inline Preview for Generated Tests
 * Implements Speculative Insertion pattern: directly insert code with green decoration and CodeLens buttons
 */

import * as vscode from 'vscode';
import { ReviewCodeLensProvider, PendingEdit } from './reviewCodeLensProvider';

/**
 * Preview Manager using Speculative Insertion pattern
 */
export class InlinePreviewManager {
	private currentEdit: PendingEdit | null = null;
	private decorationType: vscode.TextEditorDecorationType;
	private codeLensProvider: ReviewCodeLensProvider;
	private documentChangeListener?: vscode.Disposable;

	constructor(codeLensProvider: ReviewCodeLensProvider) {
		// Create decoration type for green background (like Diff Add)
		this.decorationType = vscode.window.createTextEditorDecorationType({
			backgroundColor: 'rgba(40, 167, 69, 0.2)', // Green background
			isWholeLine: true,
			borderColor: 'rgba(40, 167, 69, 1)',
			borderWidth: '0 0 0 2px', // Left green border
			borderStyle: 'solid'
		});

		this.codeLensProvider = codeLensProvider;
	}

	/**
	 * Show preview using Speculative Insertion pattern
	 * 1. Insert code directly into editor
	 * 2. Format the code
	 * 3. Apply green decoration
	 * 4. Show CodeLens buttons
	 */
	async showPreview(
		editor: vscode.TextEditor,
		position: vscode.Position,
		generatedCode: string,
		metadata?: {
			functionName?: string;
			explanation?: string;
			scenarioDescription?: string;
			expectedCoverageImpact?: string;
		}
	): Promise<void> {
		// Clear any existing preview
		this.clearPreview();

		// Step 1: Insert code directly into editor
		const insertText = '\n\n' + generatedCode;
		const success = await editor.edit(editBuilder => {
			editBuilder.insert(position, insertText);
		});

		if (!success) {
			vscode.window.showErrorMessage('Failed to insert code');
			return;
		}

		// Step 2: Calculate the inserted range
		// We need to wait for the document to update, then get the actual range
		const document = editor.document;
		const startLine = position.line;
		const endLine = startLine + generatedCode.split('\n').length + 1; // +1 for the extra newline

		// Wait a bit for document to update
		await new Promise(resolve => setTimeout(resolve, 50));

		// Get the actual range after insertion
		const startPos = new vscode.Position(startLine, 0);
		let endPos: vscode.Position;
		if (endLine < document.lineCount) {
			endPos = new vscode.Position(endLine - 1, document.lineAt(endLine - 1).text.length);
		} else {
			endPos = new vscode.Position(document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length);
		}

		let insertedRange = new vscode.Range(startPos, endPos);

		// Step 3: Format the inserted code using VS Code native formatter
		editor.selection = new vscode.Selection(insertedRange.start, insertedRange.end);
		await vscode.commands.executeCommand('editor.action.formatSelection');

		// Wait for formatting to complete
		await new Promise(resolve => setTimeout(resolve, 200));

		// Recalculate range after formatting (formatting may change line count)
		const formattedEndLine = editor.selection.end.line;
		if (formattedEndLine >= document.lineCount) {
			endPos = new vscode.Position(document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length);
		} else {
			endPos = new vscode.Position(formattedEndLine, document.lineAt(formattedEndLine).text.length);
		}
		insertedRange = new vscode.Range(startPos, endPos);

		// Clear selection
		editor.selection = new vscode.Selection(insertedRange.start, insertedRange.start);

		// Step 4: Apply green decoration
		editor.setDecorations(this.decorationType, [insertedRange]);

		// Step 5: Set up CodeLens
		const editId = Date.now().toString();
		this.currentEdit = {
			id: editId,
			uri: document.uri,
			range: insertedRange
		};
		this.codeLensProvider.setPendingEdit(this.currentEdit);

		// Step 6: Monitor document changes - if user edits the green area, auto-accept
		this.documentChangeListener = vscode.workspace.onDidChangeTextDocument((e) => {
			if (e.document.uri.toString() !== document.uri.toString()) {
				return;
			}

			if (!this.currentEdit) {
				return;
			}

			// Check if any change overlaps with the inserted range
			for (const change of e.contentChanges) {
				const changeRange = change.range;
				if (
					changeRange.start.line <= this.currentEdit.range.end.line &&
					changeRange.end.line >= this.currentEdit.range.start.line
				) {
					// User is editing the green area - auto-accept
					this.acceptPreview();
					break;
				}
			}
		});

		// Show information message (no buttons - use CodeLens instead)
		vscode.window.showInformationMessage(
			'Code inserted. Use CodeLens buttons above to Accept or Discard.'
		);
	}

	/**
	 * Accept the preview - remove decoration and CodeLens, keep code
	 */
	async acceptPreview(): Promise<void> {
		if (!this.currentEdit) {
			// Already accepted or no preview active
			return;
		}

		const editor = vscode.window.visibleTextEditors.find(
			e => e.document.uri.toString() === this.currentEdit!.uri.toString()
		);

		if (editor) {
			// Remove decoration
			editor.setDecorations(this.decorationType, []);
		}

		// Clear CodeLens
		this.codeLensProvider.setPendingEdit(null);
		this.currentEdit = null;

		// Dispose document change listener
		if (this.documentChangeListener) {
			this.documentChangeListener.dispose();
			this.documentChangeListener = undefined;
		}

		vscode.window.showInformationMessage('Code accepted');
	}

	/**
	 * Reject the preview - delete the entire file
	 *
	 * User's requirement: When rejecting, simply delete the entire generated file
	 * instead of trying to selectively delete the inserted range.
	 */
	async rejectPreview(): Promise<void> {
		if (!this.currentEdit) {
			// Already rejected or no preview active
			return;
		}

		const editor = vscode.window.visibleTextEditors.find(
			e => e.document.uri.toString() === this.currentEdit!.uri.toString()
		);

		if (editor) {
			// Close the editor first
			const uri = editor.document.uri;
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

			// Delete the file
			try {
				const fs = await import('fs').then(m => m.promises);
				await fs.unlink(uri.fsPath);
				vscode.window.showInformationMessage('Generated file deleted');
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to delete file: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}

		// Clear CodeLens
		this.codeLensProvider.setPendingEdit(null);
		this.currentEdit = null;

		// Dispose document change listener
		if (this.documentChangeListener) {
			this.documentChangeListener.dispose();
			this.documentChangeListener = undefined;
		}
	}

	/**
	 * Clear the preview
	 */
	clearPreview(): void {
		if (this.currentEdit) {
			const editor = vscode.window.visibleTextEditors.find(
				e => e.document.uri.toString() === this.currentEdit!.uri.toString()
			);

			if (editor) {
				editor.setDecorations(this.decorationType, []);
			}

			this.codeLensProvider.setPendingEdit(null);
			this.currentEdit = null;
		}

		if (this.documentChangeListener) {
			this.documentChangeListener.dispose();
			this.documentChangeListener = undefined;
		}
	}

	/**
	 * Dispose resources
	 */
	dispose(): void {
		this.clearPreview();
		this.decorationType.dispose();
	}
}
