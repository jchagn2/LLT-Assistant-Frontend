/**
 * Backend API Client for Coverage Test Generation
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import * as vscode from 'vscode';
import {
	CoverageBackendError,
	CoverageOptimizationRequest,
	TaskStatusResponse
} from './types';

class CoverageError extends Error implements CoverageBackendError {
	type: 'network' | 'validation' | 'server' | 'timeout' | 'unknown';
	detail: string;
	statusCode?: number;

	constructor(error: CoverageBackendError) {
		super(error.message);
		this.name = 'CoverageError';
		this.type = error.type;
		this.detail = error.detail;
		this.statusCode = error.statusCode;
	}
}

const DEFAULTS = {
	BACKEND_URL: 'https://cs5351.efan.dev',
	TIMEOUT_MS: 60000, // 60 seconds for test generation (longer than quality analysis)
	RETRY_MAX_ATTEMPTS: 3,
	RETRY_BASE_DELAY_MS: 2000, // 2 seconds
	POLL_INTERVAL_MS: 1000, // 1 second initial poll interval
	MAX_POLL_INTERVAL_MS: 5000, // 5 seconds max poll interval
	MAX_POLL_TIMEOUT_MS: 300000 // 5 minutes max wait time
};

export class CoverageBackendClient {
	private client: AxiosInstance;
	private baseUrl: string;

	constructor() {
		this.baseUrl = this.getBackendUrl();
		this.client = axios.create({
			baseURL: this.baseUrl,
			timeout: DEFAULTS.TIMEOUT_MS,
			headers: {
				'Content-Type': 'application/json'
			}
		});

		this.setupInterceptors();
	}

	/**
	 * Get backend URL from VSCode configuration
	 */
	public getBackendUrl(): string {
		const config = vscode.workspace.getConfiguration('llt-assistant');
		const backendUrl = config.get('backendUrl', DEFAULTS.BACKEND_URL);
		console.log(`[LLT Coverage API] Reading backend URL from config: ${backendUrl} (default: ${DEFAULTS.BACKEND_URL})`);
		return backendUrl;
	}

	/**
	 * Setup request/response interceptors for logging and error handling
	 */
	private setupInterceptors(): void {
		// Request interceptor
		this.client.interceptors.request.use(
			(config) => {
				console.log(`[LLT Coverage API] ${config.method?.toUpperCase()} ${config.url}`);
				return config;
			},
			(error) => {
				return Promise.reject(error);
			}
		);

		// Response interceptor
		this.client.interceptors.response.use(
			(response) => {
				console.log(
					`[LLT Coverage API] Response: ${response.status} ${response.statusText}`
				);
				return response;
			},
			(error) => {
				return Promise.reject(this.handleApiError(error));
			}
		);
	}

	/**
	 * Request coverage optimization
	 *
	 * POST /optimization/coverage
	 * Returns 202 Accepted with task_id for async processing
	 */
	async requestCoverageOptimization(
		request: CoverageOptimizationRequest
	): Promise<TaskStatusResponse> {
		const maxRetries = DEFAULTS.RETRY_MAX_ATTEMPTS;
		let lastError: any;

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				const response = await this.client.post<TaskStatusResponse>(
					'/optimization/coverage',
					request
				);

				// Expect 202 Accepted for async task
				if (response.status === 202 || response.status === 200) {
					return response.data;
				}

				throw new Error(`Unexpected status code: ${response.status}`);
			} catch (error) {
				lastError = error;

				// Check if error is retryable
				if (!this.isRetryableError(error)) {
					throw error;
				}

				// Don't retry on last attempt
				if (attempt === maxRetries - 1) {
					break;
				}

				// Exponential backoff: 2s, 4s, 8s
				const delayMs = Math.pow(2, attempt) * DEFAULTS.RETRY_BASE_DELAY_MS;
				console.log(
					`[LLT Coverage API] Retry attempt ${attempt + 1}/${maxRetries} after ${delayMs}ms`
				);
				await this.delay(delayMs);
			}
		}

		throw lastError;
	}

	/**
	 * Poll task status
	 *
	 * GET /tasks/{task_id}
	 * Returns current status of async task
	 */
	async pollTaskStatus(taskId: string): Promise<TaskStatusResponse> {
		try {
			const response = await this.client.get<TaskStatusResponse>(`/tasks/${taskId}`);
			return response.data;
		} catch (error) {
			// Convert to CoverageBackendError for consistent error handling
			const backendError = this.handleApiError(error);
			throw new CoverageError(backendError);
		}
	}

	/**
	 * Poll task status until completion with exponential backoff
	 *
	 * @param taskId - Task ID to poll
	 * @param onProgress - Optional callback for progress updates
	 * @returns Final task status response
	 */
	async pollTaskUntilComplete(
		taskId: string,
		onProgress?: (status: TaskStatusResponse) => void
	): Promise<TaskStatusResponse> {
		const startTime = Date.now();
		let pollInterval = DEFAULTS.POLL_INTERVAL_MS;

		while (true) {
			// Check timeout
			const elapsed = Date.now() - startTime;
			if (elapsed > DEFAULTS.MAX_POLL_TIMEOUT_MS) {
				throw new CoverageError({
					type: 'timeout',
					message: 'Task polling timeout',
					detail: `Task ${taskId} did not complete within ${DEFAULTS.MAX_POLL_TIMEOUT_MS}ms`,
					statusCode: 0
				});
			}

			// Poll status
			const status = await this.pollTaskStatus(taskId);

			// Call progress callback if provided
			if (onProgress) {
				onProgress(status);
			}

			// Check if task is complete
			if (status.status === 'completed') {
				return status;
			}

			// Check if task failed
			if (status.status === 'failed') {
				throw new CoverageError({
					type: 'server',
					message: 'Task failed',
					detail: `Task ${taskId} failed during processing`,
					statusCode: 0
				});
			}

			// Wait before next poll with exponential backoff
			await this.delay(pollInterval);
			pollInterval = Math.min(
				pollInterval * 1.5,
				DEFAULTS.MAX_POLL_INTERVAL_MS
			);
		}
	}

	/**
	 * Health check endpoint
	 *
	 * GET /health
	 */
	async healthCheck(): Promise<boolean> {
		// Update backend URL from configuration before health check
		this.updateBackendUrl();
		
		try {
			const fullUrl = `${this.baseUrl}/health`;
			console.log(`[LLT Coverage API] Health check: ${fullUrl}`);
			const response = await this.client.get('/health');
			console.log(`[LLT Coverage API] Health check success: ${response.status}`);
			return response.status === 200;
		} catch (error) {
			const fullUrl = `${this.baseUrl}/health`;
			if (axios.isAxiosError(error)) {
				const axiosError = error as AxiosError;
				if (!axiosError.response) {
					console.error(`[LLT Coverage API] Health check failed (network error): ${fullUrl}`, axiosError.message);
					if (axiosError.code) {
						console.error(`[LLT Coverage API] Error code: ${axiosError.code}`);
					}
					if (axiosError.request) {
						console.error(`[LLT Coverage API] Request config:`, {
							url: axiosError.config?.url,
							baseURL: axiosError.config?.baseURL,
							method: axiosError.config?.method
						});
					}
				} else {
					console.error(`[LLT Coverage API] Health check failed (HTTP ${axiosError.response.status}): ${fullUrl}`);
					console.error(`[LLT Coverage API] Response data:`, axiosError.response.data);
				}
			} else {
				console.error(`[LLT Coverage API] Health check failed: ${fullUrl}`, error);
			}
			return false;
		}
	}

	/**
	 * Handle API errors and convert to user-friendly messages
	 */
	private handleApiError(error: any): CoverageBackendError {
		if (axios.isAxiosError(error)) {
			const axiosError = error as AxiosError;

			// Network error (backend not reachable)
			if (!axiosError.response) {
				return {
					type: 'network',
					message: 'Cannot connect to LLT backend',
					detail: `Please check if backend is running at ${this.baseUrl}`,
					statusCode: 0
				};
			}

			// HTTP error responses
			const status = axiosError.response.status;
			const data: any = axiosError.response.data;

			if (status === 400) {
				return {
					type: 'validation',
					message: 'Invalid request',
					detail: data?.detail || 'Request validation failed',
					statusCode: 400
				};
			}

			if (status === 422) {
				return {
					type: 'validation',
					message: 'Request validation error',
					detail: this.formatValidationErrors(data?.detail),
					statusCode: 422
				};
			}

			if (status >= 500) {
				return {
					type: 'server',
					message: 'Backend server error',
					detail: data?.detail || 'Internal server error',
					statusCode: status
				};
			}

			// Generic HTTP error
			return {
				type: 'unknown',
				message: `HTTP ${status} error`,
				detail: data?.detail || axiosError.message,
				statusCode: status
			};
		}

		// Timeout error
		if (error.code === 'ECONNABORTED') {
			return {
				type: 'timeout',
				message: 'Request timeout',
				detail: 'Backend took too long to respond',
				statusCode: 0
			};
		}

		// Unknown error
		return {
			type: 'unknown',
			message: 'Unknown error',
			detail: error.message || String(error),
			statusCode: 0
		};
	}

	/**
	 * Format validation errors into readable message
	 */
	private formatValidationErrors(errors: any[]): string {
		if (!errors || !Array.isArray(errors)) {
			return 'Unknown validation error';
		}

		if (errors.length === 0) {
			return 'Validation failed with no details';
		}

		return errors
			.map(err => {
				const field = Array.isArray(err.loc) ? err.loc.join('.') : 'unknown';
				const message = err.msg || 'invalid value';
				return `${field}: ${message}`;
			})
			.join('; ');
	}

	/**
	 * Update backend URL from configuration
	 */
	public updateBackendUrl(): void {
		const newUrl = this.getBackendUrl();
		console.log(`[LLT Coverage API] Updating backend URL: ${this.baseUrl} -> ${newUrl}`);
		if (newUrl !== this.baseUrl) {
			this.baseUrl = newUrl;
			this.client.defaults.baseURL = newUrl;
			console.log(`[LLT Coverage API] Backend URL updated to: ${newUrl}`);
		} else {
			console.log(`[LLT Coverage API] Backend URL unchanged: ${newUrl}`);
		}
	}

	/**
	 * Check if an error is retryable
	 */
	private isRetryableError(error: any): boolean {
		if (axios.isAxiosError(error)) {
			const axiosError = error as AxiosError;

			// Network errors (no response)
			if (!axiosError.response) {
				return true;
			}

			// Server errors (5xx)
			if (axiosError.response.status >= 500) {
				return true;
			}

			// Rate limiting (429)
			if (axiosError.response.status === 429) {
				return true;
			}
		}

		// Timeout errors
		if (error.code === 'ECONNABORTED') {
			return true;
		}

		return false;
	}

	/**
	 * Delay helper for retry backoff
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
