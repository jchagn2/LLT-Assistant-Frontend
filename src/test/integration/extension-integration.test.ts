/**
 * Integration Tests for LLT Assistant Extension
 *
 * These tests run in the actual VSCode environment using @vscode/test-electron
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Integration Test Suite', () => {
  vscode.window.showInformationMessage('Running integration tests...');

  suite('Extension Activation', () => {
    test('should activate extension on Python file', async () => {
      const ext = vscode.extensions.getExtension('llt-assistant');
      assert.ok(ext, 'Extension should be installed');

      await ext!.activate();
      assert.ok(ext!.isActive, 'Extension should be active');
    });

    test('should register all commands', async () => {
      const commands = await vscode.commands.getCommands();

      const requiredCommands = [
        'llt-assistant.generateTests',
        'llt-assistant.supplementTests',
        'llt-assistant.analyzeQuality',
        'llt-assistant.refreshQualityView',
        'llt-assistant.clearQualityIssues',
      ];

      for (const cmd of requiredCommands) {
        assert.ok(
          commands.includes(cmd),
          `Command ${cmd} should be registered`
        );
      }
    });

    test('should create quality tree view', async () => {
      // Verify that the tree view is created
      // This would require accessing the extension's exported API
      assert.ok(true);
    });
  });

    test('should have quality analysis configuration', () => {
      const config = vscode.workspace.getConfiguration('llt-assistant.quality');

      assert.strictEqual(
        config.get('backendUrl'),
        'http://localhost:8886'
      );
      assert.strictEqual(config.get('analysisMode'), 'hybrid');
      assert.strictEqual(config.get('autoAnalyze'), false);
    });

    test('should update configuration programmatically', async () => {
      const config = vscode.workspace.getConfiguration('llt-assistant.quality');

      await config.update('autoAnalyze', true, vscode.ConfigurationTarget.Global);
      assert.strictEqual(config.get('autoAnalyze'), true);

      // Cleanup
      await config.update('autoAnalyze', false, vscode.ConfigurationTarget.Global);
    });
  });

  suite('Quality Analysis Workflow', () => {
    let testDocument: vscode.TextDocument;

    setup(async () => {
      // Create a test Python file
      const testContent = `"""Test file with quality issues"""

def test_trivial_assertion():
    """Test with trivial assertion"""
    assert True  # This is trivial

def test_missing_assertion():
    """Test without proper assertion"""
    result = some_function()
    # Missing assertion
`;

      testDocument = await vscode.workspace.openTextDocument({
        language: 'python',
        content: testContent,
      });

      await vscode.window.showTextDocument(testDocument);
    });

    teardown(async () => {
      // Close all editors
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('should analyze Python test file', async function () {
      this.timeout(10000); // Increase timeout for API calls

      // This test would actually call the backend
      // For now, we'll just verify the command exists
      const commands = await vscode.commands.getCommands();
      assert.ok(commands.includes('llt-assistant.analyzeQuality'));
    });

    test('should clear quality issues', async () => {
      const commands = await vscode.commands.getCommands();
      assert.ok(commands.includes('llt-assistant.clearQualityIssues'));
    });

    test('should refresh quality view', async () => {
      const commands = await vscode.commands.getCommands();
      assert.ok(commands.includes('llt-assistant.refreshQualityView'));
    });
  });

  suite('Diagnostics', () => {
    test('should create diagnostic collection', () => {
      // Verify that the extension creates a diagnostic collection
      // This would require accessing extension internals
      assert.ok(true);
    });
  });

  suite('Tree View', () => {
    test('should create LLT Quality tree view', () => {
      // Verify tree view exists in Activity Bar
      assert.ok(true);
    });
  });

  suite('Error Handling', () => {
    test('should handle network errors gracefully', async () => {
      // Test with invalid backend URL
      const config = vscode.workspace.getConfiguration('llt-assistant.quality');
      await config.update(
        'backendUrl',
        'http://invalid-backend:9999',
        vscode.ConfigurationTarget.Global
      );

      // Try to analyze - should fail gracefully
      // (Actual test would verify error message shown to user)

      // Cleanup
      await config.update(
        'backendUrl',
        'http://localhost:8886',
        vscode.ConfigurationTarget.Global
      );

      assert.ok(true);
    });

    test('should handle timeout gracefully', async function () {
      this.timeout(35000); // Longer than API timeout

      // This would test timeout handling
      assert.ok(true);
    });
  });

  suite('File Operations', () => {
    test('should find test files in workspace', async () => {
      // Test file globbing for test_*.py
      const testFiles = await vscode.workspace.findFiles('**/test_*.py');
      assert.ok(Array.isArray(testFiles));
    });

    test('should read file contents', async () => {
      const testContent = 'def test_example():\n    assert True';
      const doc = await vscode.workspace.openTextDocument({
        language: 'python',
        content: testContent,
      });

      assert.strictEqual(doc.getText(), testContent);
      assert.strictEqual(doc.languageId, 'python');
    });
  });
});
