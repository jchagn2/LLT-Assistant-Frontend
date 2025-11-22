/**
 * Backend API Client for Feature 1 - Test Generation
 *
 * Communicates with the LLT Assistant Backend API instead of directly calling LLM APIs.
 * Implements the two-stage test generation workflow as defined in the backend OpenAPI spec.
 */

import { FunctionContext } from '../analysis/types';
import { Stage1Response, Stage2Response, IdentifiedScenario } from '../agents/types';

/**
 * Token usage information from backend
 */
export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  estimated_cost_usd?: number;
}

/**
 * Client metadata sent with requests
 */
export interface ClientMetadata {
  extension_version?: string;
  vscode_version?: string;
  platform?: string;
  workspace_hash?: string;
}

/**
 * Configuration for Stage 1 (scenarios identification)
 */
export interface Stage1Config {
  max_identified_scenarios?: number;
  max_suggested_scenarios?: number;
  auto_confirm_simple_functions?: boolean;
}

/**
 * Configuration for Stage 2 (code generation)
 */
export interface Stage2Config {
  min_test_count?: number;
  max_test_count?: number;
  use_parametrize?: boolean;
  generate_fixtures?: boolean;
}

/**
 * Request body for Stage 1: Identify test scenarios
 */
interface GenerateTestsScenariosRequest {
  function_context: FunctionContext;
  user_description: string;
  config?: Stage1Config;
  client_metadata?: ClientMetadata;
}

/**
 * Response from Stage 1: Identified scenarios
 */
interface GenerateTestsScenariosResponse {
  skip_confirmation: boolean;
  proceed_to_generation: boolean;
  identified_scenarios: IdentifiedScenario[];
  suggested_additional_scenarios: IdentifiedScenario[];
  confirmation_question: string;
  reason?: string;
  token_usage?: TokenUsage;
  request_id: string;
}

/**
 * Request body for Stage 2: Generate pytest code
 */
interface GenerateTestsCodeRequest {
  function_context: FunctionContext;
  confirmed_scenarios: IdentifiedScenario[];
  stage1_request_id?: string;
  user_additional_notes?: string;
  config?: Stage2Config;
  client_metadata?: ClientMetadata;
}

/**
 * Response from Stage 2: Generated test code
 */
interface GenerateTestsCodeResponse {
  test_code: string;
  imports: string[];
  test_count: number;
  coverage_summary: string;
  notes?: string;
  token_usage?: TokenUsage;
  request_id: string;
  related_stage1_request_id?: string;
}

/**
 * Backend API Client for Test Generation
 */
export class BackendApiClient {
  private baseUrl: string;
  private cumulativeTokenUsage: TokenUsage = {
    total_tokens: 0,
    estimated_cost_usd: 0
  };

  constructor(baseUrl?: string) {
    // Default to production server, can be overridden with config
    this.baseUrl = baseUrl || 'https://cs5351.efan.dev';
  }

  /**
   * Execute Stage 1: Identify test scenarios
   *
   * Calls POST /workflows/generate-tests/scenarios
   *
   * @param functionContext - Function context from code analysis
   * @param userDescription - User's test description (1-200 characters)
   * @param config - Optional Stage 1 configuration
   * @returns Stage1Response with identified scenarios
   */
  async executeStage1(
    functionContext: FunctionContext,
    userDescription: string,
    config?: Stage1Config
  ): Promise<Stage1Response> {
    const requestBody: GenerateTestsScenariosRequest = {
      function_context: functionContext,
      user_description: userDescription,
      config,
      client_metadata: this.getClientMetadata()
    };

    try {
      const response = await fetch(`${this.baseUrl}/workflows/generate-tests/scenarios`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(
          `Backend API error (Stage 1): ${response.status} ${response.statusText}. ${
            errorData.message || ''
          }`
        );
      }

      const data = await response.json() as GenerateTestsScenariosResponse;

      // Update cumulative token usage
      if (data.token_usage) {
        this.updateTokenUsage(data.token_usage);
      }

      // Transform backend response to Stage1Response format
      return {
        skip_confirmation: data.skip_confirmation,
        proceed_to_generation: data.proceed_to_generation,
        identified_scenarios: data.identified_scenarios,
        suggested_additional_scenarios: data.suggested_additional_scenarios,
        confirmation_question: data.confirmation_question,
        reason: data.reason
      };
    } catch (error) {
      console.error('[Backend API] Stage 1 error:', error);
      throw error;
    }
  }

  /**
   * Execute Stage 2: Generate pytest code
   *
   * Calls POST /workflows/generate-tests/code
   *
   * @param functionContext - Function context from code analysis
   * @param confirmedScenarios - Scenarios confirmed by user from Stage 1
   * @param stage1RequestId - Optional request ID from Stage 1 for context continuity
   * @param userAdditionalNotes - Optional additional requirements from user
   * @param config - Optional Stage 2 configuration
   * @returns Stage2Response with generated test code
   */
  async executeStage2(
    functionContext: FunctionContext,
    confirmedScenarios: IdentifiedScenario[],
    stage1RequestId?: string,
    userAdditionalNotes?: string,
    config?: Stage2Config
  ): Promise<Stage2Response> {
    const requestBody: GenerateTestsCodeRequest = {
      function_context: functionContext,
      confirmed_scenarios: confirmedScenarios,
      stage1_request_id: stage1RequestId,
      user_additional_notes: userAdditionalNotes,
      config,
      client_metadata: this.getClientMetadata()
    };

    try {
      const response = await fetch(`${this.baseUrl}/workflows/generate-tests/code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(
          `Backend API error (Stage 2): ${response.status} ${response.statusText}. ${
            errorData.message || ''
          }`
        );
      }

      const data = await response.json() as GenerateTestsCodeResponse;

      // Update cumulative token usage
      if (data.token_usage) {
        this.updateTokenUsage(data.token_usage);
      }

      // Transform backend response to Stage2Response format
      return {
        test_code: data.test_code,
        imports: data.imports,
        test_count: data.test_count,
        coverage_summary: data.coverage_summary,
        notes: data.notes
      };
    } catch (error) {
      console.error('[Backend API] Stage 2 error:', error);
      throw error;
    }
  }

  /**
   * Get cumulative token usage statistics
   *
   * @returns Token usage with total tokens and estimated cost
   */
  getTokenUsage(): { totalTokens: number; totalCost: number } {
    return {
      totalTokens: this.cumulativeTokenUsage.total_tokens || 0,
      totalCost: this.cumulativeTokenUsage.estimated_cost_usd || 0
    };
  }

  /**
   * Reset token usage statistics
   */
  resetTokenUsage(): void {
    this.cumulativeTokenUsage = {
      total_tokens: 0,
      estimated_cost_usd: 0
    };
  }

  /**
   * Update cumulative token usage
   * @private
   */
  private updateTokenUsage(usage: TokenUsage): void {
    this.cumulativeTokenUsage.total_tokens =
      (this.cumulativeTokenUsage.total_tokens || 0) + (usage.total_tokens || 0);
    this.cumulativeTokenUsage.estimated_cost_usd =
      (this.cumulativeTokenUsage.estimated_cost_usd || 0) + (usage.estimated_cost_usd || 0);
  }

  /**
   * Get client metadata for requests
   * @private
   */
  private getClientMetadata(): ClientMetadata {
    // In VSCode extension context, we can get version info
    // For now, returning basic metadata
    return {
      extension_version: '1.0.0',
      platform: process.platform
    };
  }

  /**
   * Set custom base URL for the backend API
   *
   * @param url - Custom backend URL
   */
  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  /**
   * Get current base URL
   *
   * @returns Current backend base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
