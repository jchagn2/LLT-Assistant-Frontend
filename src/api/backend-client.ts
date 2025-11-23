/**
 * Backend API Client for Feature 1 - Test Generation
 *
 * Communicates with the LLT Assistant Backend API.
 * Implements the async workflow: POST /workflows/generate-tests + polling
 */

import axios, { AxiosError } from 'axios';
import {
  GenerateTestsRequest,
  AsyncJobResponse,
  TaskStatusResponse
} from '../generation/types';

/**
 * Backend API Client for Test Generation
 */
export class BackendApiClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    // Default to production server, can be overridden with config
    this.baseUrl = baseUrl || 'http://localhost:8886/api/v1';
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
    try {
      const response = await axios.post<AsyncJobResponse>(
        `${this.baseUrl}/workflows/generate-tests`,
        request,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      const formattedError = this.handleAxiosError(error);
      console.error('[Backend API] Generate tests async error:', formattedError);
      throw formattedError;
    }
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
    try {
      const response = await axios.get<TaskStatusResponse>(
        `${this.baseUrl}/tasks/${taskId}`,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      const formattedError = this.handleAxiosError(error, taskId);
      console.error('[Backend API] Poll task status error:', formattedError);
      throw formattedError;
    }
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

  private handleAxiosError(error: unknown, taskId?: string): Error {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        const messageBody = this.formatResponseBody(error);
        if (error.response.status === 404 && taskId) {
          return new Error(`Task ${taskId} not found`);
        }

        return new Error(
          `Backend API error: ${error.response.status} ${error.response.statusText}. ${messageBody}`
        );
      }

      if (error.request) {
        return new Error('Backend API request failed: No response received');
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    return new Error(`Backend API request failed: ${message}`);
  }

  private formatResponseBody(error: AxiosError): string {
    const data = error.response?.data;
    if (!data) {
      return '';
    }

    if (typeof data === 'string') {
      return data;
    }

    try {
      return JSON.stringify(data);
    } catch {
      return '';
    }
  }
}
