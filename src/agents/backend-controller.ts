/**
 * Backend Agent Flow Controller
 *
 * Orchestrates the two-stage test generation pipeline using the backend API
 * instead of directly calling LLM APIs.
 *
 * - Stage 1: Information Gathering (scenario identification) via backend
 * - Stage 2: Test Generation (pytest code generation) via backend
 */

import { FunctionContext } from '../analysis/types';
import {
  Stage1Response,
  Stage2Response,
  UserConfirmationResult,
  PipelineExecutionResult,
  PipelineTokenUsage,
  Stage1Config as AgentStage1Config,
  Stage2Config as AgentStage2Config
} from './types';
import { BackendApiClient, Stage1Config, Stage2Config } from '../api/backend-client';
import { InputValidator } from './input-validator';

/**
 * Backend Agent Flow Controller
 *
 * Manages the complete test generation pipeline using the backend API.
 * Handles both stages, user confirmation, and error recovery.
 */
export class BackendAgentController {
  private backendClient: BackendApiClient;
  private inputValidator: InputValidator;
  private stage1Config?: Stage1Config;
  private stage2Config?: Stage2Config;

  constructor(
    backendUrl?: string,
    stage1Config?: Partial<AgentStage1Config>,
    stage2Config?: Partial<AgentStage2Config>
  ) {
    this.backendClient = new BackendApiClient(backendUrl);
    this.inputValidator = new InputValidator();

    // Convert agent configs to backend configs
    if (stage1Config) {
      this.stage1Config = {
        max_identified_scenarios: stage1Config.maxIdentifiedScenarios,
        max_suggested_scenarios: stage1Config.maxSuggestedScenarios,
        auto_confirm_simple_functions: stage1Config.autoConfirmSimpleFunctions
      };
    }

    if (stage2Config) {
      this.stage2Config = {
        min_test_count: stage2Config.minTestCount,
        max_test_count: stage2Config.maxTestCount,
        use_parametrize: stage2Config.useParametrize,
        generate_fixtures: stage2Config.generateFixtures
      };
    }
  }

  /**
   * Execute Stage 1: Information Gathering
   *
   * Analyzes function code and user description to identify test scenarios
   * using the backend API.
   *
   * @param context - Function context from code analysis
   * @param userDescription - User's test description
   * @returns Stage 1 response with identified scenarios
   */
  async executeStage1(
    context: FunctionContext,
    userDescription: string
  ): Promise<Stage1Response> {
    // Validate user input
    const validation = this.inputValidator.validateUserInput(userDescription);
    if (!validation.isValid) {
      throw new Error(`Invalid user input: ${validation.suggestions?.join(', ')}`);
    }

    // Call backend API Stage 1
    return await this.backendClient.executeStage1(
      context,
      userDescription,
      this.stage1Config
    );
  }

  /**
   * Execute Stage 2: Test Generation
   *
   * Generates pytest test code based on confirmed scenarios using the backend API.
   *
   * @param context - Function context from code analysis
   * @param stage1Response - Response from Stage 1 with scenarios
   * @param userAdditionalNotes - Optional additional requirements from user
   * @returns Stage 2 response with test code
   */
  async executeStage2(
    context: FunctionContext,
    stage1Response: Stage1Response,
    userAdditionalNotes?: string
  ): Promise<Stage2Response> {
    // Combine identified and suggested scenarios
    const allScenarios = [
      ...stage1Response.identified_scenarios,
      ...stage1Response.suggested_additional_scenarios
    ];

    // Call backend API Stage 2
    return await this.backendClient.executeStage2(
      context,
      allScenarios,
      undefined, // stage1RequestId - backend tracks this internally
      userAdditionalNotes,
      this.stage2Config
    );
  }

  /**
   * Run complete pipeline: Stage 1 → User Confirmation → Stage 2
   *
   * This is the main entry point for the full test generation flow.
   *
   * @param context - Function context from code analysis
   * @param userDescription - User's test description
   * @param confirmationHandler - Callback to handle user confirmation (if needed)
   * @returns Complete pipeline execution result
   */
  async runFullPipeline(
    context: FunctionContext,
    userDescription: string,
    confirmationHandler: (stage1Response: Stage1Response) => Promise<UserConfirmationResult>
  ): Promise<PipelineExecutionResult> {
    const startTime = Date.now();

    // Reset token usage
    this.backendClient.resetTokenUsage();

    try {
      // Stage 1: Identify scenarios
      const stage1Response = await this.executeStage1(context, userDescription);
      const tokensAfterStage1 = this.backendClient.getTokenUsage();

      let userConfirmation: UserConfirmationResult | undefined;
      let finalStage1Response = stage1Response;

      // Handle user confirmation if needed
      if (!stage1Response.skip_confirmation) {
        userConfirmation = await confirmationHandler(stage1Response);

        if (userConfirmation.cancelled) {
          return {
            success: false,
            stage1Response,
            userConfirmation,
            totalTokens: tokensAfterStage1.totalTokens,
            estimatedCost: tokensAfterStage1.totalCost,
            error: 'User cancelled',
            executionTime: Date.now() - startTime
          };
        }

        if (!userConfirmation.confirmed) {
          return {
            success: false,
            stage1Response,
            userConfirmation,
            totalTokens: tokensAfterStage1.totalTokens,
            estimatedCost: tokensAfterStage1.totalCost,
            error: 'User did not confirm',
            executionTime: Date.now() - startTime
          };
        }
      }

      // Stage 2: Generate tests
      const stage2Response = await this.executeStage2(
        context,
        finalStage1Response,
        userConfirmation?.additionalScenarios
      );

      const tokensAfterStage2 = this.backendClient.getTokenUsage();

      return {
        success: true,
        stage1Response: finalStage1Response,
        stage2Response,
        userConfirmation,
        totalTokens: tokensAfterStage2.totalTokens,
        estimatedCost: tokensAfterStage2.totalCost,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      const tokenUsage = this.backendClient.getTokenUsage();

      return {
        success: false,
        totalTokens: tokenUsage.totalTokens,
        estimatedCost: tokenUsage.totalCost,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Run simplified pipeline without user confirmation
   *
   * Useful for auto-confirmation scenarios or when testing.
   *
   * @param context - Function context from code analysis
   * @param userDescription - User's test description
   * @returns Complete pipeline execution result
   */
  async runPipelineWithoutConfirmation(
    context: FunctionContext,
    userDescription: string
  ): Promise<PipelineExecutionResult> {
    // Use a confirmation handler that always confirms
    return this.runFullPipeline(context, userDescription, async (stage1Response) => ({
      confirmed: true,
      cancelled: false
    }));
  }

  /**
   * Get token usage for the current session
   */
  getTokenUsage(): PipelineTokenUsage {
    const usage = this.backendClient.getTokenUsage();
    return {
      stage1Tokens: 0, // Backend doesn't split this yet
      stage2Tokens: 0,
      totalTokens: usage.totalTokens,
      estimatedCost: usage.totalCost
    };
  }

  /**
   * Validate user input before running pipeline
   *
   * @param userDescription - User's test description
   * @returns Validation result
   */
  validateInput(userDescription: string) {
    return this.inputValidator.validateUserInput(userDescription);
  }

  /**
   * Generate input guidance for user
   *
   * @param context - Function context
   * @returns Input guidance
   */
  generateInputGuidance(context: FunctionContext) {
    return this.inputValidator.generateInputGuidance(context);
  }

  /**
   * Check if function is simple enough for auto-confirmation
   *
   * @param context - Function context
   * @returns true if function is simple (< 10 lines, no branches)
   */
  shouldAutoConfirmSimpleFunction(context: FunctionContext): boolean {
    if (!this.stage1Config?.auto_confirm_simple_functions) {
      return false;
    }

    const { body_analysis, source_code } = context;

    // Count lines of actual code
    const codeLines = source_code
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();
        return trimmed.length > 0 &&
               !trimmed.startsWith('#') &&
               !trimmed.startsWith('"""') &&
               !trimmed.startsWith("'''");
      }).length;

    return (
      codeLines < 10 &&
      body_analysis.complexity === 1 &&
      body_analysis.exceptions.length === 0
    );
  }

  /**
   * Set custom backend URL
   *
   * @param url - Backend API base URL
   */
  setBackendUrl(url: string): void {
    this.backendClient.setBaseUrl(url);
  }

  /**
   * Get current backend URL
   *
   * @returns Backend API base URL
   */
  getBackendUrl(): string {
    return this.backendClient.getBaseUrl();
  }
}
