import * as vscode from 'vscode';
import { ApiProvider, PluginConfiguration } from '../types';

/**
 * Manages plugin configuration including API keys and provider settings
 */
export class ConfigurationManager {
  private readonly configSection = 'llt-assistant';

  /**
   * Get the current plugin configuration
   * @returns Complete plugin configuration
   */
  public getConfiguration(): PluginConfiguration {
    const config = vscode.workspace.getConfiguration(this.configSection);

    return {
      apiProvider: config.get<ApiProvider>('apiProvider', 'openai'),
      apiKey: config.get<string>('apiKey', ''),
      modelName: config.get<string>('modelName', 'gpt-4'),
      temperature: config.get<number>('temperature', 0.3),
      maxTokens: config.get<number>('maxTokens', 2000)
    };
  }

  /**
   * Get API key for the configured provider
   * @returns Promise<string> - The API key
   * @throws Error if API key is not configured
   */
  public async getApiKey(): Promise<string> {
    const config = this.getConfiguration();

    if (!config.apiKey || config.apiKey.trim() === '') {
      // Prompt user to enter API key
      const key = await vscode.window.showInputBox({
        prompt: `Enter your ${config.apiProvider.toUpperCase()} API key`,
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value || value.trim() === '') {
            return 'API key cannot be empty';
          }
          return null;
        }
      });

      if (!key) {
        throw new Error('API key is required to generate tests');
      }

      // Save the API key
      await this.setApiKey(key);
      return key;
    }

    return config.apiKey;
  }

  /**
   * Set API key in workspace configuration
   * @param apiKey - The API key to save
   */
  public async setApiKey(apiKey: string): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.configSection);
    await config.update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
  }

  /**
   * Get the configured API provider
   * @returns API provider ('openai' | 'claude')
   */
  public getApiProvider(): ApiProvider {
    return this.getConfiguration().apiProvider;
  }

  /**
   * Get the configured model name
   * @returns Model identifier string
   */
  public getModelName(): string {
    return this.getConfiguration().modelName;
  }

  /**
   * Get the configured temperature
   * @returns Temperature value (0-2)
   */
  public getTemperature(): number {
    return this.getConfiguration().temperature;
  }

  /**
   * Get the configured max tokens
   * @returns Maximum tokens for response
   */
  public getMaxTokens(): number {
    return this.getConfiguration().maxTokens;
  }

  /**
   * Validate current configuration
   * @returns Object with validation result
   */
  public validateConfiguration(): { valid: boolean; errors: string[] } {
    const config = this.getConfiguration();
    const errors: string[] = [];

    if (!config.apiProvider) {
      errors.push('API provider not configured');
    }

    if (!config.modelName) {
      errors.push('Model name not configured');
    }

    if (config.temperature < 0 || config.temperature > 2) {
      errors.push('Temperature must be between 0 and 2');
    }

    if (config.maxTokens <= 0) {
      errors.push('Max tokens must be greater than 0');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
