import { ChatMessage, LLMCallOptions, LLMResponse, TokenUsage, ApiProvider } from '../types';
import { ApiErrorHandler } from './errorHandler';

/**
 * HTTP client for calling LLM APIs (OpenAI and Claude)
 */
export class LLMApiClient {
  private errorHandler: ApiErrorHandler;
  private tokenUsage: TokenUsage = { totalTokens: 0, totalCost: 0 };

  constructor(
    private apiKey: string,
    private provider: ApiProvider,
    private modelName: string
  ) {
    this.errorHandler = new ApiErrorHandler();
  }

  /**
   * Call the LLM API with the provided messages
   * @param messages - Array of chat messages
   * @param options - Optional parameters for the API call
   * @returns Promise<LLMResponse> - The API response
   */
  public async callLLM(
    messages: ChatMessage[],
    options?: LLMCallOptions
  ): Promise<LLMResponse> {
    if (this.provider === 'openai') {
      return this.callOpenAI(messages, options);
    } else {
      return this.callClaude(messages, options);
    }
  }

  /**
   * Call LLM API with automatic retry on transient failures
   * @param messages - Array of chat messages
   * @param maxRetries - Maximum number of retry attempts (default: 3)
   * @returns Promise<LLMResponse> - The API response
   */
  public async callWithRetry(
    messages: ChatMessage[],
    maxRetries: number = 3
  ): Promise<LLMResponse> {
    let lastError: any;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.callLLM(messages);
      } catch (error) {
        lastError = error;

        // Check if we should retry
        if (!this.errorHandler.shouldRetry(error) || attempt === maxRetries) {
          throw error;
        }

        // Wait before retrying (exponential backoff)
        const delay = this.errorHandler.getRetryDelay(attempt);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Get cumulative token usage statistics
   * @returns TokenUsage object with total tokens and estimated cost
   */
  public getTokenUsage(): TokenUsage {
    return { ...this.tokenUsage };
  }

  /**
   * Reset token usage statistics
   */
  public resetTokenUsage(): void {
    this.tokenUsage = { totalTokens: 0, totalCost: 0 };
  }

  /**
   * Call OpenAI API
   * @private
   */
  private async callOpenAI(
    messages: ChatMessage[],
    options?: LLMCallOptions
  ): Promise<LLMResponse> {
    const url = 'https://api.openai.com/v1/chat/completions';

    const requestBody: any = {
      model: this.modelName,
      messages: messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 2000
    };

    // Handle JSON mode for OpenAI
    if (options?.responseFormat === 'json_object') {
      requestBody.response_format = { type: 'json_object' };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error: any = new Error(`OpenAI API error: ${response.statusText}`);
        error.status = response.status;
        error.statusText = response.statusText;
        error.error = errorData;
        throw error;
      }

      const data = await response.json() as any;

      // Extract response
      const content = data.choices?.[0]?.message?.content || '';
      const usage = {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      };

      // Update cumulative usage
      this.updateTokenUsage(usage.totalTokens, this.estimateCost('openai', usage));

      return {
        content,
        model: data.model || this.modelName,
        usage
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Call Claude (Anthropic) API
   * @private
   */
  private async callClaude(
    messages: ChatMessage[],
    options?: LLMCallOptions
  ): Promise<LLMResponse> {
    const url = 'https://api.anthropic.com/v1/messages';

    // Claude requires separating system messages
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const requestBody: any = {
      model: this.modelName,
      messages: conversationMessages,
      max_tokens: options?.maxTokens ?? 2000,
      temperature: options?.temperature ?? 0.3
    };

    if (systemMessage) {
      requestBody.system = systemMessage;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error: any = new Error(`Claude API error: ${response.statusText}`);
        error.status = response.status;
        error.statusText = response.statusText;
        error.error = errorData;
        throw error;
      }

      const data = await response.json() as any;

      // Extract response
      const content = data.content?.[0]?.text || '';
      const usage = {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
      };

      // Update cumulative usage
      this.updateTokenUsage(usage.totalTokens, this.estimateCost('claude', usage));

      return {
        content,
        model: data.model || this.modelName,
        usage
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update cumulative token usage
   * @private
   */
  private updateTokenUsage(tokens: number, cost: number): void {
    this.tokenUsage.totalTokens += tokens;
    this.tokenUsage.totalCost += cost;
  }

  /**
   * Estimate cost based on token usage
   * @private
   */
  private estimateCost(provider: ApiProvider, usage: { promptTokens: number; completionTokens: number }): number {
    // Rough estimates (prices as of 2024, per 1M tokens)
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4': { input: 30, output: 60 },
      'gpt-4-turbo': { input: 10, output: 30 },
      'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
      'claude-3-opus': { input: 15, output: 75 },
      'claude-3-sonnet': { input: 3, output: 15 },
      'claude-3-haiku': { input: 0.25, output: 1.25 }
    };

    // Find matching pricing (rough match by model name prefix)
    let rates = { input: 10, output: 30 }; // Default rates
    for (const [model, price] of Object.entries(pricing)) {
      if (this.modelName.toLowerCase().includes(model.toLowerCase())) {
        rates = price;
        break;
      }
    }

    const inputCost = (usage.promptTokens / 1_000_000) * rates.input;
    const outputCost = (usage.completionTokens / 1_000_000) * rates.output;

    return inputCost + outputCost;
  }

  /**
   * Sleep utility for retry delays
   * @private
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
