import * as vscode from 'vscode';

/**
 * Function information extracted from code
 */
interface FunctionInfo {
  name: string;
  code: string;
  parameters: string[];
  returnType?: string;
  docstring?: string;
  modulePath: string;
}

/**
 * Utility functions for analyzing Python code
 */
export class CodeAnalyzer {
  /**
   * Extract function information from the current selection or cursor position
   * @param editor - The active text editor
   * @returns FunctionInfo or null if no function found
   */
  public static extractFunctionInfo(editor: vscode.TextEditor): FunctionInfo | null {
    const document = editor.document;
    const selection = editor.selection;

    // Get the text content
    let functionText: string;
    let startLine: number;

    if (!selection.isEmpty) {
      // User has selected text
      functionText = document.getText(selection);
      startLine = selection.start.line;
    } else {
      // Try to find the function at cursor position
      const cursorLine = selection.active.line;
      const functionRange = this.findFunctionRange(document, cursorLine);

      if (!functionRange) {
        return null;
      }

      functionText = document.getText(functionRange);
      startLine = functionRange.start.line;
    }

    // Parse function information
    const functionName = this.extractFunctionName(functionText);
    if (!functionName) {
      return null;
    }

    const parameters = this.extractParameters(functionText);
    const returnType = this.extractReturnType(functionText);
    const docstring = this.extractDocstring(functionText);
    const modulePath = this.getModulePath(document);

    return {
      name: functionName,
      code: functionText,
      parameters,
      returnType,
      docstring,
      modulePath
    };
  }

  /**
   * Find the range of a function definition containing the given line
   * @private
   */
  private static findFunctionRange(
    document: vscode.TextDocument,
    lineNumber: number
  ): vscode.Range | null {
    const lines = document.getText().split('\n');

    // Find function start (search backwards for 'def ' or 'async def ')
    let startLine = lineNumber;
    let foundDefLine = -1;

    while (startLine >= 0) {
      const trimmed = lines[startLine].trim();
      // Support both regular and async functions
      if (trimmed.startsWith('def ') || trimmed.startsWith('async def ')) {
        foundDefLine = startLine;
        break;
      }
      startLine--;
    }

    if (foundDefLine < 0) {
      return null;
    }

    // Check for decorators above the function definition
    let actualStartLine = foundDefLine;
    let checkLine = foundDefLine - 1;

    while (checkLine >= 0) {
      const trimmed = lines[checkLine].trim();

      // Empty lines or comments are allowed
      if (trimmed === '' || trimmed.startsWith('#')) {
        checkLine--;
        continue;
      }

      // If it's a decorator, include it
      if (trimmed.startsWith('@')) {
        actualStartLine = checkLine;
        checkLine--;
        continue;
      }

      // Otherwise, stop searching
      break;
    }

    startLine = actualStartLine;

    // Find function end (next function or class, or end of file)
    const startIndent = this.getIndentation(lines[startLine]);
    let endLine = startLine + 1;

    while (endLine < lines.length) {
      const line = lines[endLine];
      const trimmed = line.trim();

      // Empty lines are part of the function
      if (trimmed === '') {
        endLine++;
        continue;
      }

      const currentIndent = this.getIndentation(line);

      // If we find a line at same or lower indentation that starts a new block, stop
      if (currentIndent <= startIndent && (trimmed.startsWith('def ') || trimmed.startsWith('class '))) {
        break;
      }

      // If indentation is less than function start and not empty, stop
      if (currentIndent < startIndent && trimmed !== '') {
        break;
      }

      endLine++;
    }

    return new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLine - 1, lines[endLine - 1].length)
    );
  }

  /**
   * Get indentation level of a line
   * @private
   */
  private static getIndentation(line: string): number {
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }

  /**
   * Extract function name from function definition
   * @private
   */
  private static extractFunctionName(functionText: string): string | null {
    // Support both 'def' and 'async def' functions
    const match = functionText.match(/(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
    return match ? match[1] : null;
  }

  /**
   * Extract function parameters
   * @private
   */
  private static extractParameters(functionText: string): string[] {
    // Support both 'def' and 'async def' functions
    const match = functionText.match(/(?:async\s+)?def\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\((.*?)\)/s);
    if (!match) {
      return [];
    }

    const paramsText = match[1].trim();
    if (!paramsText) {
      return [];
    }

    // Simple parameter extraction (doesn't handle complex nested structures)
    return paramsText
      .split(',')
      .map(p => p.trim())
      .filter(p => p !== 'self' && p !== 'cls')
      .map(p => p.split(':')[0].trim().split('=')[0].trim());
  }

  /**
   * Extract return type annotation if present
   * @private
   */
  private static extractReturnType(functionText: string): string | undefined {
    const match = functionText.match(/\)\s*->\s*([^:]+):/);
    return match ? match[1].trim() : undefined;
  }

  /**
   * Extract docstring if present
   * @private
   */
  private static extractDocstring(functionText: string): string | undefined {
    // Match both ''' and """ docstrings, support both 'def' and 'async def'
    const match = functionText.match(/(?:async\s+)?def\s+[^:]+:\s*(?:\n\s*)?('''|""")(.+?)\1/s);
    return match ? match[2].trim() : undefined;
  }

  /**
   * Get module path from document URI
   * @private
   */
  private static getModulePath(document: vscode.TextDocument): string {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return document.fileName;
    }

    const relativePath = document.uri.fsPath.replace(workspaceFolder.uri.fsPath, '');
    // Convert file path to Python module path
    return relativePath
      .replace(/^\//, '')
      .replace(/\.py$/, '')
      .replace(/\//g, '.')
      .replace(/\\/g, '.');
  }

  /**
   * Validate that the selected text is a Python function
   * @param text - Text to validate
   * @returns true if text appears to be a function definition
   */
  public static isValidPythonFunction(text: string): boolean {
    const trimmed = text.trim();
    // Check if it starts with 'def' or 'async def' and contains '(' and ':'
    return /^\s*(?:async\s+)?def\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\([^)]*\)\s*(->\s*[^:]+)?\s*:/.test(trimmed);
  }

  /**
   * Find existing test file for a given source file
   *
   * Searches for test files in common patterns:
   * - tests/test_*.py
   * - test/test_*.py
   * - src/tests/test_*.py
   * - Same directory as source file
   *
   * @param sourceFilePath - Absolute path to the source Python file
   * @returns Absolute path to test file if found, null otherwise
   */
  public static async findExistingTestFile(sourceFilePath: string): Promise<string | null> {
    const path = await import('path');
    const fs = await import('fs').then(m => m.promises);

    // Extract filename without extension
    const basename = path.basename(sourceFilePath, '.py');
    const dirname = path.dirname(sourceFilePath);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      return null;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;

    // Define search patterns in order of preference
    const patterns = [
      path.join(workspaceRoot, 'tests', `test_${basename}.py`),
      path.join(workspaceRoot, 'test', `test_${basename}.py`),
      path.join(workspaceRoot, 'src', 'tests', `test_${basename}.py`),
      path.join(dirname, `test_${basename}.py`)
    ];

    // Try each pattern
    for (const testPath of patterns) {
      try {
        const stats = await fs.stat(testPath);
        if (stats.isFile()) {
          return testPath;
        }
      } catch (error) {
        // File doesn't exist, continue to next pattern
        continue;
      }
    }

    return null;
  }

  /**
   * Read file content as string
   *
   * @param filePath - Absolute path to file
   * @returns File content or null if file doesn't exist
   */
  public static async readFileContent(filePath: string): Promise<string | null> {
    try {
      const fs = await import('fs').then(m => m.promises);
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (error) {
      return null;
    }
  }
}
