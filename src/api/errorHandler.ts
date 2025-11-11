import { ErrorResult, ErrorType } from '../types';

/**
 * Handles API errors and provides user-friendly error messages
 */
export class ApiErrorHandler {
  /**
   * Process an error and return structured error information
   * @param error - The error object to handle
   * @returns ErrorResult with retry info and user message
   */
  public handleError(error: any): ErrorResult {
    // Handle different types of errors
    if (this.isAuthError(error)) {
      return {
        isRetryable: false,
        errorType: 'auth',
        userMessage: 'Authentication failed. Please check your API key in settings.'
      };
    }

    if (this.isRateLimitError(error)) {
      return {
        isRetryable: true,
        errorType: 'rate_limit',
        userMessage: 'Rate limit exceeded. Please try again in a few moments.'
      };
    }

    if (this.isNetworkError(error)) {
      return {
        isRetryable: true,
        errorType: 'network',
        userMessage: 'Network error occurred. Please check your connection and try again.'
      };
    }

    if (this.isInvalidRequestError(error)) {
      return {
        isRetryable: false,
        errorType: 'invalid_request',
        userMessage: `Invalid request: ${this.extractErrorMessage(error)}`
      };
    }

    // Unknown error
    return {
      isRetryable: false,
      errorType: 'unknown',
      userMessage: `An unexpected error occurred: ${this.extractErrorMessage(error)}`
    };
  }

  /**
   * Determine if an error should trigger a retry
   * @param error - The error object to check
   * @returns true if the operation should be retried
   */
  public shouldRetry(error: any): boolean {
    const result = this.handleError(error);
    return result.isRetryable;
  }

  /**
   * Check if error is an authentication error
   */
  private isAuthError(error: any): boolean {
    if (error.status === 401 || error.statusCode === 401) {
      return true;
    }

    const message = this.extractErrorMessage(error).toLowerCase();
    return message.includes('unauthorized') ||
           message.includes('invalid api key') ||
           message.includes('authentication');
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: any): boolean {
    if (error.status === 429 || error.statusCode === 429) {
      return true;
    }

    const message = this.extractErrorMessage(error).toLowerCase();
    return message.includes('rate limit') ||
           message.includes('too many requests');
  }

  /**
   * Check if error is a network error
   */
  private isNetworkError(error: any): boolean {
    if (error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND') {
      return true;
    }

    const message = this.extractErrorMessage(error).toLowerCase();
    return message.includes('network') ||
           message.includes('timeout') ||
           message.includes('connection');
  }

  /**
   * Check if error is an invalid request error
   */
  private isInvalidRequestError(error: any): boolean {
    if (error.status === 400 || error.statusCode === 400) {
      return true;
    }

    const message = this.extractErrorMessage(error).toLowerCase();
    return message.includes('invalid') ||
           message.includes('bad request');
  }

  /**
   * Extract error message from various error formats
   */
  private extractErrorMessage(error: any): string {
    if (typeof error === 'string') {
      return error;
    }

    if (error.message) {
      return error.message;
    }

    if (error.error && typeof error.error === 'string') {
      return error.error;
    }

    if (error.error && error.error.message) {
      return error.error.message;
    }

    if (error.response && error.response.data) {
      if (typeof error.response.data === 'string') {
        return error.response.data;
      }
      if (error.response.data.error) {
        if (typeof error.response.data.error === 'string') {
          return error.response.data.error;
        }
        if (error.response.data.error.message) {
          return error.response.data.error.message;
        }
      }
    }

    return 'Unknown error occurred';
  }

  /**
   * Get retry delay in milliseconds based on attempt number
   * Uses exponential backoff strategy
   * @param attempt - The current attempt number (0-indexed)
   * @returns Delay in milliseconds
   */
  public getRetryDelay(attempt: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const baseDelay = 1000;
    const maxDelay = 16000;
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    return delay;
  }
}
