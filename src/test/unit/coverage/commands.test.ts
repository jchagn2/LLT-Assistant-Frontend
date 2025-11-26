/**
 * Unit tests for Coverage Commands
 * Tests command behavior, file handling, and error scenarios
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CoverageCommands } from '../../../coverage/commands/analyze';
import { CoverageTreeDataProvider } from '../../../coverage/activityBar/provider';
import { CoverageBackendClient } from '../../../coverage/api/client';

suite('CoverageCommands', () => {
	let commands: CoverageCommands;
	let treeProvider: CoverageTreeDataProvider;
	let backendClient: CoverageBackendClient;
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
		treeProvider = new CoverageTreeDataProvider();
		backendClient = new CoverageBackendClient();
		commands = new CoverageCommands(treeProvider, backendClient);
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('showCoverageItem', () => {
		test('should show warning when file does not exist', async () => {
			const nonExistentFile = '/path/to/nonexistent/file.py';
			const func = { startLine: 10, endLine: 20 };

			// Mock VSCode APIs
			const showWarningStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined);
			const openTextDocumentStub = sandbox.stub(vscode.workspace, 'openTextDocument');

			await commands.showCoverageItem(nonExistentFile, func);

			// Should show warning message
			expect(showWarningStub.calledOnce).to.be.true;
			const warningCall = showWarningStub.getCall(0);
			expect(warningCall.args[0]).to.include('File not found');

			// Should NOT attempt to open the document
			expect(openTextDocumentStub.called).to.be.false;
		});

		test('should offer to re-analyze coverage when file not found', async () => {
			const nonExistentFile = '/path/to/nonexistent/file.py';
			const func = { startLine: 10, endLine: 20 };

			// Mock user clicking "Re-analyze Coverage"
			const showWarningStub = sandbox.stub(vscode.window, 'showWarningMessage')
				.resolves('Re-analyze Coverage' as any);
			const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();

			await commands.showCoverageItem(nonExistentFile, func);

			// Should execute re-analyze command
			expect(executeCommandStub.calledWith('llt-assistant.analyzeCoverage')).to.be.true;
		});

		test('should open and highlight file when it exists', async () => {
			// Create a temporary test file
			const tempFile = path.join(__dirname, 'fixtures', 'temp-test.py');
			const fileContent = '# Line 1\n# Line 2\n# Line 3\n# Line 4\n# Line 5\n';

			try {
				await fs.promises.writeFile(tempFile, fileContent);

				const func = { startLine: 2, endLine: 4 };

				// Mock VSCode APIs
				const mockDocument = {
					uri: vscode.Uri.file(tempFile),
					lineCount: 5,
					lineAt: (line: number) => ({ text: `# Line ${line + 1}` })
				} as any;

				const mockEditor = {
					setDecorations: sandbox.stub(),
					revealRange: sandbox.stub()
				} as any;

				sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument);
				sandbox.stub(vscode.window, 'showTextDocument').resolves(mockEditor);

				await commands.showCoverageItem(tempFile, func);

				// Should set decorations
				expect(mockEditor.setDecorations.calledOnce).to.be.true;

				// Should reveal range
				expect(mockEditor.revealRange.calledOnce).to.be.true;
			} finally {
				// Cleanup
				try {
					await fs.promises.unlink(tempFile);
				} catch {
					// Ignore cleanup errors
				}
			}
		});

		test('should handle errors gracefully', async () => {
			const validFile = path.join(__dirname, 'fixtures', 'valid-coverage.xml');
			const func = { startLine: 1, endLine: 5 };

			// Mock openTextDocument to throw error
			sandbox.stub(vscode.workspace, 'openTextDocument').rejects(new Error('Mock error'));
			const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

			await commands.showCoverageItem(validFile, func);

			// Should show error message
			expect(showErrorStub.calledOnce).to.be.true;
			expect(showErrorStub.getCall(0).args[0]).to.include('Failed to show coverage item');
		});

		test('should convert 1-based line numbers to 0-based', async () => {
			const tempFile = path.join(__dirname, 'fixtures', 'temp-test2.py');
			const fileContent = 'line1\nline2\nline3\n';

			try {
				await fs.promises.writeFile(tempFile, fileContent);

				const func = { startLine: 2, endLine: 3 }; // 1-based

				const mockDocument = {
					uri: vscode.Uri.file(tempFile),
					lineCount: 3,
					lineAt: (line: number) => ({ text: `line${line + 1}` })
				} as any;

				const mockEditor = {
					setDecorations: sandbox.stub(),
					revealRange: sandbox.stub()
				} as any;

				sandbox.stub(vscode.workspace, 'openTextDocument').resolves(mockDocument);
				sandbox.stub(vscode.window, 'showTextDocument').resolves(mockEditor);

				await commands.showCoverageItem(tempFile, func);

				// Check that setDecorations was called with 0-based range
				const decorationCall = mockEditor.setDecorations.getCall(0);
				const range = decorationCall.args[1][0] as vscode.Range;

				// startLine 2 (1-based) should become 1 (0-based)
				expect(range.start.line).to.equal(1);
				// endLine 3 (1-based) should become 2 (0-based)
				expect(range.end.line).to.equal(2);
			} finally {
				try {
					await fs.promises.unlink(tempFile);
				} catch {
					// Ignore cleanup errors
				}
			}
		});
	});

	suite('clearCoverage', () => {
		test('should clear tree provider data', () => {
			const clearSpy = sandbox.spy(treeProvider, 'clear');

			commands.clearCoverage();

			expect(clearSpy.calledOnce).to.be.true;
		});
	});
});
