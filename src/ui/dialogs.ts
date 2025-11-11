import * as vscode from 'vscode';
import { ConfirmationResult } from '../types';

/**
 * UI dialog components for user interaction
 */
export class UIDialogs {
  /**
   * Show input box to collect test description from user
   * @param options - Configuration for the input box
   * @returns Promise<string | undefined> - User input or undefined if cancelled
   */
  public static async showTestDescriptionInput(options?: {
    prompt?: string;
    placeHolder?: string;
    validateInput?: (text: string) => string | null;
  }): Promise<string | undefined> {
    return vscode.window.showInputBox({
      prompt: options?.prompt || 'Describe the test scenarios you want to generate (50-200 words)',
      placeHolder: options?.placeHolder || 'e.g., Test the login function with valid and invalid credentials',
      ignoreFocusOut: true,
      validateInput: options?.validateInput || ((text: string) => {
        const trimmed = text.trim();
        if (trimmed.length < 10) {
          return 'Please provide a more detailed description (at least 10 characters)';
        }
        if (trimmed.length > 500) {
          return 'Description is too long (maximum 500 characters)';
        }
        return null;
      })
    });
  }

  /**
   * Show scenario confirmation dialog with quick picks
   * @param question - The confirmation question to display
   * @param scenarios - List of identified scenarios
   * @returns Promise<ConfirmationResult> - User's confirmation choice
   */
  public static async showScenarioConfirmation(
    question: string,
    scenarios: string[]
  ): Promise<ConfirmationResult> {
    // First, show the scenarios in an information message
    const scenarioList = scenarios.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const fullMessage = `${question}\n\n${scenarioList}`;

    // Show quick pick with options
    const choice = await vscode.window.showQuickPick(
      [
        { label: '✓ Proceed', description: 'Generate tests with these scenarios', value: 'proceed' },
        { label: '+ Add More', description: 'Add additional scenarios', value: 'add_more' },
        { label: '✗ Cancel', description: 'Cancel test generation', value: 'cancel' }
      ],
      {
        placeHolder: fullMessage,
        ignoreFocusOut: true
      }
    );

    if (!choice || choice.value === 'cancel') {
      return { action: 'cancel' };
    }

    if (choice.value === 'add_more') {
      // Prompt for additional scenarios
      const additionalInput = await vscode.window.showInputBox({
        prompt: 'Describe additional test scenarios',
        placeHolder: 'e.g., Test with empty input, test with special characters',
        ignoreFocusOut: true
      });

      if (!additionalInput) {
        return { action: 'cancel' };
      }

      return {
        action: 'add_more',
        additionalInput
      };
    }

    return { action: 'proceed' };
  }

  /**
   * Show progress notification while executing a task
   * @param message - Progress message to display
   * @param task - The async task to execute
   * @returns Promise<T> - Result of the task
   */
  public static async withProgress<T>(
    message: string,
    task: () => Promise<T>
  ): Promise<T> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: message,
        cancellable: false
      },
      async () => {
        return await task();
      }
    );
  }

  /**
   * Show error message to the user
   * @param message - Error message to display
   * @param actions - Optional action buttons
   * @returns Promise<string | undefined> - Selected action or undefined
   */
  public static async showError(
    message: string,
    actions?: string[]
  ): Promise<string | undefined> {
    if (actions && actions.length > 0) {
      return vscode.window.showErrorMessage(message, ...actions);
    }
    await vscode.window.showErrorMessage(message);
    return undefined;
  }

  /**
   * Show success message to the user
   * @param message - Success message to display
   * @param actions - Optional action buttons
   * @returns Promise<string | undefined> - Selected action or undefined
   */
  public static async showSuccess(
    message: string,
    actions?: string[]
  ): Promise<string | undefined> {
    if (actions && actions.length > 0) {
      return vscode.window.showInformationMessage(message, ...actions);
    }
    await vscode.window.showInformationMessage(message);
    return undefined;
  }

  /**
   * Show warning message to the user
   * @param message - Warning message to display
   * @param actions - Optional action buttons
   * @returns Promise<string | undefined> - Selected action or undefined
   */
  public static async showWarning(
    message: string,
    actions?: string[]
  ): Promise<string | undefined> {
    if (actions && actions.length > 0) {
      return vscode.window.showWarningMessage(message, ...actions);
    }
    await vscode.window.showWarningMessage(message);
    return undefined;
  }

  /**
   * Show a multi-line message in a webview panel (for longer content)
   * @param title - Panel title
   * @param content - Content to display
   */
  public static showDetailedMessage(title: string, content: string): void {
    const panel = vscode.window.createWebviewPanel(
      'lltAssistantDetails',
      title,
      vscode.ViewColumn.Beside,
      {}
    );

    panel.webview.html = this.getWebviewContent(title, content);
  }

  /**
   * Generate HTML content for webview
   * @private
   */
  private static getWebviewContent(title: string, content: string): string {
    const escapedContent = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        pre {
            background-color: var(--vscode-textBlockQuote-background);
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
        }
    </style>
</head>
<body>
    <h1>${title}</h1>
    <div>${escapedContent}</div>
</body>
</html>`;
  }
}
