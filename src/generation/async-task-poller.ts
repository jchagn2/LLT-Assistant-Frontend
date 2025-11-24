/**
 * Async Task Poller for Test Generation
 *
 * Polls the backend API for async task completion.
 * Used for Feature 1 (Test Generation) async workflow.
 */

import axios from 'axios';
import { TaskStatusResponse, GenerateTestsResult } from './types';

/**
 * Polling configuration
 */
interface PollingConfig {
  /** Polling interval in milliseconds (default: 1500ms) */
  intervalMs?: number;

  /** Maximum timeout in milliseconds (default: 60000ms = 60s) */
  timeoutMs?: number;

  /** Base URL for the backend API */
  baseUrl: string;

  /** Task ID to poll */
  taskId: string;
}

/**
 * Polling events that can be emitted
 */
type PollingEvent =
  | { type: 'pending'; taskId: string }
  | { type: 'processing'; taskId: string }
  | { type: 'completed'; result: GenerateTestsResult }
  | { type: 'failed'; error: string }
  | { type: 'timeout'; taskId: string };

/**
 * Callback for polling events
 */
type PollingEventCallback = (event: PollingEvent) => void;

/**
 * Error thrown when task polling fails
 */
class TaskPollingError extends Error {
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
 */
class TaskTimeoutError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly elapsedMs: number
  ) {
    super(`Task ${taskId} timed out after ${elapsedMs}ms`);
    this.name = 'TaskTimeoutError';
  }
}

/**
 * Async Task Poller
 *
 * Polls the backend API until task completion or timeout.
 */
class TaskPoller {
  private readonly config: Required<PollingConfig>;
  private eventCallback?: PollingEventCallback;
  private startTime: number = 0;
  private pollingTimer?: NodeJS.Timeout;

  constructor(config: PollingConfig) {
    this.config = {
      intervalMs: config.intervalMs ?? 1500, // Default: 1.5 seconds
      timeoutMs: config.timeoutMs ?? 60000,  // Default: 60 seconds
      baseUrl: config.baseUrl,
      taskId: config.taskId
    };
  }

  /**
   * Register event callback for progress updates
   */
  public onEvent(callback: PollingEventCallback): void {
    this.eventCallback = callback;
  }

  /**
   * Start polling and return result when completed
   *
   * @throws {TaskPollingError} If task fails or API returns error
   * @throws {TaskTimeoutError} If task exceeds timeout
   */
  public async poll(): Promise<GenerateTestsResult> {
    this.startTime = Date.now();

    return new Promise((resolve, reject) => {
      // Start polling
      this.pollOnce(resolve, reject);
    });
  }

  /**
   * Cancel ongoing polling
   */
  public cancel(): void {
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  /**
   * Execute a single poll
   */
  private async pollOnce(
    resolve: (result: GenerateTestsResult) => void,
    reject: (error: Error) => void
  ): Promise<void> {
    // Check timeout
    const elapsed = Date.now() - this.startTime;
    if (elapsed >= this.config.timeoutMs) {
      const error = new TaskTimeoutError(this.config.taskId, elapsed);
      this.emitEvent({ type: 'timeout', taskId: this.config.taskId });
      reject(error);
      return;
    }

    try {
      // Fetch task status
      const url = `${this.config.baseUrl}/tasks/${this.config.taskId}`;
      const response = await axios.get<TaskStatusResponse>(url, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const taskStatus = response.data;

      // Handle different statuses
      switch (taskStatus.status) {
        case 'pending':
          this.emitEvent({ type: 'pending', taskId: this.config.taskId });
          this.scheduleNextPoll(resolve, reject);
          break;

        case 'processing':
          this.emitEvent({ type: 'processing', taskId: this.config.taskId });
          this.scheduleNextPoll(resolve, reject);
          break;

        case 'completed':
          if (!taskStatus.result) {
            throw new TaskPollingError(
              'Task completed but no result returned',
              this.config.taskId
            );
          }
          this.emitEvent({ type: 'completed', result: taskStatus.result });
          resolve(taskStatus.result);
          break;

        case 'failed':
          const errorMessage = taskStatus.error?.message ?? 'Unknown error';
          this.emitEvent({ type: 'failed', error: errorMessage });
          throw new TaskPollingError(
            `Task failed: ${errorMessage}`,
            this.config.taskId
          );

        default:
          throw new TaskPollingError(
            `Unknown task status: ${taskStatus.status}`,
            this.config.taskId
          );
      }
    } catch (error) {
      // If it's our custom error, reject with it
      if (error instanceof TaskPollingError || error instanceof TaskTimeoutError) {
        reject(error);
        return;
      }

      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;

        if (status === 404) {
          reject(new TaskPollingError(
            `Task ${this.config.taskId} not found`,
            this.config.taskId,
            status
          ));
          return;
        }

        const body = this.stringifyAxiosResponse(error.response.data);
        reject(new TaskPollingError(
          `HTTP ${status}: ${body}`,
          this.config.taskId,
          status
        ));
        return;
      }

      // Network or parsing errors
      const message = this.extractAxiosErrorMessage(error);
      reject(new TaskPollingError(
        `Polling failed: ${message}`,
        this.config.taskId
      ));
    }
  }

  private extractAxiosErrorMessage(error: unknown): string {
    // axios will throw an error with response/request metadata
    if (axios.isAxiosError(error)) {
      if (error.response) {
        const status = error.response.status;

        if (status === 404) {
          return `Task ${this.config.taskId} not found`;
        }

        const body = this.stringifyAxiosResponse(error.response.data);
        return `HTTP ${status}: ${body}`;
      }

      if (error.request) {
        return 'No response received from backend';
      }
    }

    return error instanceof Error ? error.message : String(error);
  }

  private stringifyAxiosResponse(data: unknown): string {
    if (typeof data === 'string') {
      return data;
    }

    try {
      return JSON.stringify(data);
    } catch {
      return '';
    }
  }

  /**
   * Schedule the next poll
   */
  private scheduleNextPoll(
    resolve: (result: GenerateTestsResult) => void,
    reject: (error: Error) => void
  ): void {
    this.pollingTimer = setTimeout(() => {
      this.pollOnce(resolve, reject);
    }, this.config.intervalMs);
  }

  /**
   * Emit event to callback
   */
  private emitEvent(event: PollingEvent): void {
    if (this.eventCallback) {
      this.eventCallback(event);
    }
  }
}

/**
 * Convenience function to poll a task
 *
 * @param config Polling configuration
 * @param onEvent Optional event callback for progress updates
 * @returns Promise that resolves to the task result
 */
export async function pollTask(
  config: PollingConfig,
  onEvent?: PollingEventCallback
): Promise<GenerateTestsResult> {
  const poller = new TaskPoller(config);

  if (onEvent) {
    poller.onEvent(onEvent);
  }

  return await poller.poll();
}
