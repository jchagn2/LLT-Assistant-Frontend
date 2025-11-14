/**
 * Core type definitions for the test generation plugin
 */

/**
 * Supported LLM API providers
 */
export type ApiProvider = 'openai' | 'claude' | 'deepseek' | 'openrouter';

/**
 * Chat message structure for LLM API calls
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Options for LLM API calls
 */
export interface LLMCallOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json_object';
}

/**
 * Response from LLM API
 */
export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Token usage statistics
 */
export interface TokenUsage {
  totalTokens: number;
  totalCost: number; // Estimated cost in USD
}

/**
 * Error type classification
 */
export type ErrorType = 'auth' | 'rate_limit' | 'network' | 'invalid_request' | 'unknown';

/**
 * Result from error handling
 */
export interface ErrorResult {
  isRetryable: boolean;
  userMessage: string;
  errorType: ErrorType;
}

/**
 * User confirmation result from scenario confirmation dialog
 */
export interface ConfirmationResult {
  action: 'proceed' | 'add_more' | 'cancel';
  additionalInput?: string;
}

/**
 * Configuration for the plugin
 */
export interface PluginConfiguration {
  apiProvider: ApiProvider;
  apiKey: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
}

/**
 * Function information extracted from code
 */
export interface FunctionInfo {
  name: string;
  code: string;
  parameters: string[];
  returnType?: string;
  docstring?: string;
  modulePath: string;
}

/**
 * Test scenario identified by Stage 1 agent
 */
export interface TestScenario {
  scenario: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'code_analysis' | 'user_input' | 'suggested';
  reason?: string;
}

/**
 * Stage 1 agent output structure
 */
export interface Stage1Output {
  identified_scenarios: TestScenario[];
  suggested_additional_scenarios: TestScenario[];
  confirmation_question: string;
  skip_confirmation: boolean;
}

/**
 * Input for Stage 2 test generation
 */
export interface Stage2Input {
  functionInfo: FunctionInfo;
  confirmedScenarios: TestScenario[];
  additionalNotes?: string;
}
