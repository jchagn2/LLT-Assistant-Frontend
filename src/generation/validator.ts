/**
 * Validator Module
 *
 * Handles Python syntax validation and dependency checking for generated test code.
 */

import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  ValidationResult,
  SyntaxError as SyntaxErrorType,
  DependencyCheck
} from './types';

const execAsync = promisify(exec);

// Optional tree-sitter imports (may fail if native module not available)
let Parser: any;
let pythonLanguage: any;
let pythonParser: any;

try {
  const treeSitter = require('tree-sitter');
  const Python = require('tree-sitter-python');
  Parser = treeSitter.default || treeSitter;
  pythonLanguage = Python.default || Python;
} catch (error) {
  console.warn('[Validator] tree-sitter not available, syntax validation will be skipped:', error);
  Parser = null;
  pythonLanguage = null;
}

/**
 * Validate Python syntax of test code
 *
 * Uses Python's AST parser to check for syntax errors
 *
 * @param code - Python test code to validate
 * @returns Validation result with errors and warnings
 */
export async function validatePythonSyntax(code: string): Promise<ValidationResult> {
  // Skip validation if tree-sitter is not available
  if (!Parser || !pythonLanguage) {
    console.warn('[Validator] tree-sitter not available, skipping syntax validation');
    return {
      isValid: true, // Assume valid if we can't validate
      errors: [],
      warnings: []
    };
  }

  try {
    const parser = getPythonParser();
    const tree = parser.parse(code);

    if (!tree.rootNode.hasError) {
      return {
        isValid: true,
        errors: [],
        warnings: []
      };
    }

    const errors = collectSyntaxErrors(tree.rootNode, code);

    return {
      isValid: errors.length === 0,
      errors,
      warnings: []
    };
  } catch (error) {
    console.warn('[Validator] Syntax validation error:', error);
    return {
      isValid: true, // Assume valid on error to avoid blocking
      errors: [],
      warnings: [{
        line: 0,
        message: `Syntax validation skipped: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'warning'
      }]
    };
  }
}

function getPythonParser(): any {
  if (!Parser || !pythonLanguage) {
    throw new Error('tree-sitter is not available');
  }

  if (!pythonParser) {
    pythonParser = new Parser();
    pythonParser.setLanguage(pythonLanguage);
  }

  return pythonParser;
}

function collectSyntaxErrors(root: any, code: string): SyntaxErrorType[] {
  const errors: SyntaxErrorType[] = [];
  const seen = new Set<string>();
  const lines = code.split(/\r?\n/);
  const stack: any[] = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }

  const key = `${node.startIndex}:${node.endIndex}:${node.type}:${node.isMissing}`;
  const isProblematic = node.type === 'ERROR' || node.isMissing;

    if (isProblematic && !seen.has(key)) {
      seen.add(key);
      errors.push(formatSyntaxError(node, lines));
    }

    for (const child of node.children) {
      stack.push(child);
    }
  }

  return errors;
}

function formatSyntaxError(node: any, lines: string[]): SyntaxErrorType {
  const lineIndex = node.startPosition.row;
  const columnIndex = node.startPosition.column;
  const lineText = lines[lineIndex] ?? '';

  let message: string;
  if (node.isMissing) {
    message = `Missing ${node.type.replace(/_/g, ' ')} token`;
  } else {
    const snippet = sanitizeSnippet(node.text);
    message = snippet
      ? `Unexpected syntax near "${snippet}"`
      : 'Unexpected syntax';
  }

  return {
    line: lineIndex + 1,
    column: columnIndex + 1,
    message,
    severity: 'error',
    context: lineText
  };
}

function sanitizeSnippet(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > 40
    ? `${normalized.slice(0, 37)}...`
    : normalized;
}

/**
 * Check if test dependencies are available
 *
 * Verifies that all imported modules are installed in the Python environment
 *
 * @param testCode - Python test code
 * @param projectRoot - Project root directory
 * @returns Dependency check result
 */
export async function checkTestDependencies(
  testCode: string,
  projectRoot: string
): Promise<DependencyCheck> {
  // Extract all imports from test code
  const imports = extractImportsFromCode(testCode);

  // Get list of installed packages
  const installedPackages = await getInstalledPackages();

  // Check which packages are missing
  const missingModules: string[] = [];

  for (const imp of imports) {
    const moduleName = getBaseModuleName(imp);

    // Skip standard library modules
    if (isStandardLibrary(moduleName)) {
      continue;
    }

    // Skip local project modules
    if (isLocalModule(moduleName, projectRoot)) {
      continue;
    }

    // Check if installed
    if (!installedPackages.has(moduleName)) {
      missingModules.push(moduleName);
    }
  }

  // Generate install command
  const installCommand = missingModules.length > 0
    ? `pip install ${missingModules.join(' ')}`
    : '';

  // Try to find requirements.txt
  const requirementsPath = findRequirementsFile(projectRoot);

  return {
    allAvailable: missingModules.length === 0,
    missingModules,
    installCommand,
    requirementsPath
  };
}

/**
 * Extract all import statements from code
 *
 * @param code - Python code
 * @returns Array of module names
 */
function extractImportsFromCode(code: string): string[] {
  const imports: string[] = [];
  const lines = code.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Match: import xxx
    const importMatch = trimmed.match(/^import\s+([\w.]+)/);
    if (importMatch) {
      imports.push(importMatch[1]);
      continue;
    }

    // Match: from xxx import yyy
    const fromMatch = trimmed.match(/^from\s+([\w.]+)\s+import/);
    if (fromMatch) {
      imports.push(fromMatch[1]);
    }
  }

  return imports;
}

/**
 * Get base module name from a full module path
 *
 * Example: "pytest.mark.parametrize" → "pytest"
 *
 * @param modulePath - Full module path
 * @returns Base module name
 */
function getBaseModuleName(modulePath: string): string {
  return modulePath.split('.')[0];
}

/**
 * Check if a module is part of Python standard library
 *
 * @param moduleName - Module name
 * @returns True if it's a standard library module
 */
function isStandardLibrary(moduleName: string): boolean {
  // Common standard library modules
  const stdLibModules = new Set([
    'os', 'sys', 'json', 'typing', 're', 'datetime', 'collections',
    'itertools', 'functools', 'pathlib', 'unittest', 'logging',
    'subprocess', 'threading', 'multiprocessing', 'asyncio',
    'math', 'random', 'string', 'time', 'copy', 'pickle',
    'csv', 'xml', 'html', 'urllib', 'http', 'email', 'io',
    'tempfile', 'shutil', 'glob', 'fnmatch', 'argparse', 'getopt',
    'warnings', 'contextlib', 'abc', 'enum', 'dataclasses'
  ]);

  return stdLibModules.has(moduleName);
}

/**
 * Check if a module is a local project module
 *
 * @param moduleName - Module name
 * @param projectRoot - Project root directory
 * @returns True if it's a local module
 */
function isLocalModule(moduleName: string, projectRoot: string): boolean {
  // Check if there's a corresponding .py file or package directory
  const possiblePaths = [
    path.join(projectRoot, `${moduleName}.py`),
    path.join(projectRoot, moduleName, '__init__.py'),
    path.join(projectRoot, 'src', `${moduleName}.py`),
    path.join(projectRoot, 'src', moduleName, '__init__.py')
  ];

  return possiblePaths.some(p => fs.existsSync(p));
}

/**
 * Get list of installed Python packages
 *
 * @returns Set of installed package names
 */
async function getInstalledPackages(): Promise<Set<string>> {
  try {
    const { stdout } = await execAsync('pip list --format=json');
    const packages = JSON.parse(stdout);

    const installedSet = new Set<string>();

    for (const pkg of packages) {
      // Normalize package names (replace - with _)
      const normalizedName = pkg.name.toLowerCase().replace(/-/g, '_');
      installedSet.add(normalizedName);
      installedSet.add(pkg.name.toLowerCase());
    }

    return installedSet;
  } catch (error) {
    console.error('Failed to get installed packages:', error);
    // Return empty set if pip list fails
    return new Set<string>();
  }
}

/**
 * Find requirements.txt file in project
 *
 * @param projectRoot - Project root directory
 * @returns Path to requirements.txt if found, undefined otherwise
 */
function findRequirementsFile(projectRoot: string): string | undefined {
  const possiblePaths = [
    path.join(projectRoot, 'requirements.txt'),
    path.join(projectRoot, 'requirements', 'requirements.txt'),
    path.join(projectRoot, 'requirements', 'base.txt'),
    path.join(projectRoot, 'requirements', 'dev.txt')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return undefined;
}

/**
 * Validate that test code follows pytest conventions
 *
 * Checks for:
 * - Test functions start with "test_"
 * - Test classes start with "Test"
 * - No empty test methods
 *
 * @param code - Python test code
 * @returns Array of warnings
 */
export function validatePytestConventions(code: string): SyntaxErrorType[] {
  const warnings: SyntaxErrorType[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check test function naming
    if (trimmed.startsWith('def ') && !trimmed.startsWith('def test_') && !trimmed.startsWith('def __')) {
      const funcName = trimmed.match(/def\s+(\w+)/)?.[1];
      if (funcName) {
        warnings.push({
          line: i + 1,
          message: `Function '${funcName}' does not follow pytest naming convention (should start with 'test_')`,
          severity: 'warning'
        });
      }
    }

    // Check test class naming
    if (trimmed.startsWith('class ') && !trimmed.startsWith('class Test')) {
      const className = trimmed.match(/class\s+(\w+)/)?.[1];
      if (className) {
        warnings.push({
          line: i + 1,
          message: `Test class '${className}' should start with 'Test' (e.g., 'Test${className}')`,
          severity: 'warning'
        });
      }
    }
  }

  return warnings;
}

/**
 * Format validation errors for display to user
 *
 * @param errors - Array of syntax errors
 * @returns Formatted error message
 */
export function formatValidationErrors(errors: SyntaxErrorType[]): string {
  if (errors.length === 0) {
    return 'No errors found.';
  }

  const lines: string[] = ['Validation errors found:', ''];

  for (const error of errors) {
    const location = error.column !== undefined
      ? `Line ${error.line}, Column ${error.column}`
      : `Line ${error.line}`;

    lines.push(`[${error.severity.toUpperCase()}] ${location}: ${error.message}`);

    if (error.context) {
      lines.push(`  > ${error.context}`);
    }
  }

  return lines.join('\n');
}
