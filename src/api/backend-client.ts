/**
 * Backend API Client for Feature 1 - Test Generation
 *
 * Communicates with the LLT Assistant Backend API.
 * Implements the async workflow: POST /workflows/generate-tests + polling
 *
 * ✨ Refactored to use BaseBackendClient and AsyncTaskPoller
 */

import { BaseBackendClient, BaseClientOptions } from './baseBackendClient';
import { AsyncTaskPoller, TaskStatusResponse as GenericTaskStatusResponse } from './asyncTaskPoller';
import {
  GenerateTestsRequest,
  AsyncJobResponse,
  TaskStatusResponse,
  GenerateTestsResult
} from '../generation/types';

/**
 * Error thrown when task polling fails
 * @deprecated Use TaskFailedError from AsyncTaskPoller
 */
export class TaskPollingError extends Error {
  constructor(
    message: string,
    public readonly taskId: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'TaskPollingError';
  }
}

/**
 * Error thrown when task times out
 * @deprecated Use TaskTimeoutError from AsyncTaskPoller
 */
export class TaskTimeoutError extends Error {
  constructor(
    public readonly taskId: string,
    message: string
  ) {
    super(message);
    this.name = 'TaskTimeoutError';
  }
}

/**
 * Polling options
 */
export interface PollingOptions {
  /** Polling interval in milliseconds (default: 1500ms) */
  intervalMs?: number;
  /** Maximum timeout in milliseconds (default: 60000ms = 60s) */
  timeoutMs?: number;
}

/**
 * Backend API Client for Test Generation
 *
 * Inherits from BaseBackendClient for standardized error handling,
 * health checks, and request management.
 */
export class BackendApiClient extends BaseBackendClient {
  private taskPoller: AsyncTaskPoller<GenerateTestsResult>;

  constructor(baseUrl?: string) {
    // Initialize base client with feature-specific settings
    super({
      baseUrl,
      featureName: 'Test Generation',
      timeout: 30000,
      enableRequestId: true
    });

    // Initialize task poller with default options
    this.taskPoller = new AsyncTaskPoller<GenerateTestsResult>({
      initialIntervalMs: 1500,
      maxIntervalMs: 5000,
      timeoutMs: 60000,
      backoffMultiplier: 1.5,
      jitterFactor: 0.1
    });
  }

  /**
   * Trigger async test generation
   *
   * Calls POST /workflows/generate-tests
   *
   * @param request - Test generation request payload
   * @returns AsyncJobResponse with task_id for polling
   */
  async generateTestsAsync(request: GenerateTestsRequest): Promise<AsyncJobResponse> {
    console.log('[Test Generation] Request Payload:', JSON.stringify(request, null, 2));

    const response = await this.client.post<AsyncJobResponse>(
      '/workflows/generate-tests',
      request
    );

    console.log('[Test Generation] Initial Response:', JSON.stringify(response.data, null, 2));

    return response.data;
  }

  /**
   * Poll async task status
   *
   * Calls GET /tasks/{task_id}
   *
   * @param taskId - Task identifier from generateTestsAsync
   * @returns TaskStatusResponse with current status and result (if completed)
   */
  async pollTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    const response = await this.client.get<TaskStatusResponse>(
      `/tasks/${taskId}`
    );

    return response.data;
  }

  /**
   * Poll task status until completion with exponential backoff + jitter
   *
   * @param taskId - Task ID to poll
   * @param onProgress - Optional callback for progress updates
   * @param options - Polling options (intervalMs, timeoutMs)
   * @returns Final task result when completed
   * @throws {TaskTimeoutError} If task exceeds timeout
   * @throws {TaskPollingError} If task fails
   */
  async pollTaskUntilComplete(
    taskId: string,
    onProgress?: (status: TaskStatusResponse) => void,
    options?: PollingOptions
  ): Promise<GenerateTestsResult> {
    // Update poller options if provided
    if (options) {
      this.taskPoller.setOptions({
        initialIntervalMs: options.intervalMs,
        timeoutMs: options.timeoutMs
      });
    }

    try {
      // Use AsyncTaskPoller for standardized polling with jitter
      const result = await this.taskPoller.poll(
        taskId,
        (id) => this.pollTaskStatus(id),
        (status) => {
          // Adapter: Convert GenericTaskStatusResponse to TaskStatusResponse for callback
          if (onProgress) {
            onProgress(status as TaskStatusResponse);
          }
        }
      );

      return result;
    } catch (error: any) {
      // Convert AsyncTaskPoller errors to legacy error types for backward compatibility
      if (error.name === 'TaskTimeoutError') {
        throw new TaskTimeoutError(taskId, error.message);
      }
      if (error.name === 'TaskFailedError') {
        throw new TaskPollingError(error.message, taskId);
      }
      throw error;
    }
  }

  /**
   * Set custom base URL for the backend API
   *
   * @param url - Custom backend URL
   * @deprecated Use updateBackendUrl() from BaseBackendClient
   */
  setBaseUrl(url: string): void {
    this.baseUrl = url;
    this.client.defaults.baseURL = url;
    console.log(`[LLT Test Generation] Backend URL updated to: ${url}`);
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
