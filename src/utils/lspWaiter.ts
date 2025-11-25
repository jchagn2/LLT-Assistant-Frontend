
import * as vscode from 'vscode';
import { LSP_MAX_RETRIES, LSP_RETRY_BASE_DELAY_MS } from '../config';

/**
 * Pauses execution for a specified number of milliseconds.
 * @param ms - The number of milliseconds to sleep.
 * @returns A promise that resolves after the specified delay.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Checks if the Python LSP server is ready by attempting to fetch document symbols for a Python file.
 * @returns A promise that resolves to true if the LSP is ready, false otherwise.
 */
export async function checkLSPReady(): Promise<boolean> {
  const pythonFiles = await vscode.workspace.findFiles('**/*.py', '**/node_modules/**', 1);
  if (pythonFiles.length === 0) {
    console.log('[LLT] No Python files found in workspace to check LSP readiness.');
    // If there are no python files, we can consider the "indexing" part as done.
    return true;
  }

  const testFileUri = pythonFiles[0];
  try {
    const document = await vscode.workspace.openTextDocument(testFileUri);
    // Do not show the document in the editor
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri);
    // If the LSP is not ready, it might return an empty array or throw an error.
    // A non-empty array is a good indicator that the LSP is functioning.
    if (symbols && symbols.length > 0) {
      console.log('[LLT] LSP is ready. Found symbols in', testFileUri.fsPath);
      return true;
    }
    // In some cases, a file might legitimately have no symbols.
    // But for the readiness check, we'll be conservative and assume an empty array means "not ready yet".
    console.log('[LLT] LSP check returned empty symbols for', testFileUri.fsPath);
    return false;
  } catch (error) {
    console.error('[LLT] Error checking LSP readiness:', error);
    return false;
  }
}

/**
 * Waits for the LSP to become ready, using an exponential backoff retry strategy.
 * @param maxRetries - The maximum number of times to retry (defaults to config value).
 * @param initialDelay - The initial delay in milliseconds (defaults to config value).
 * @returns A promise that resolves to true if the LSP becomes ready, false otherwise.
 */
export async function waitForLSP(
  maxRetries = LSP_MAX_RETRIES,
  initialDelay = LSP_RETRY_BASE_DELAY_MS
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    if (await checkLSPReady()) {
      return true;
    }
    const delay = initialDelay * Math.pow(2, i);
    console.log(`[LLT] LSP not ready, retry ${i + 1}/${maxRetries} in ${delay}ms`);
    await sleep(delay);
  }
  return false;
}
