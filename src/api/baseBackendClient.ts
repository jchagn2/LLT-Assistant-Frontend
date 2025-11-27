/**
 * Base Backend Client
 *
 * Provides common functionality for all backend API clients:
 * - Standardized error handling
 * - Health check
 * - Axios instance management
 * - Backend URL configuration
 * - Retry logic support
 * - Request interceptors for observability (X-Request-ID header support)
 */

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { BackendConfigManager } from '../utils/backendConfig';
import { randomUUID } from 'crypto';

/**
 * Standard backend error types
 */
export type BackendErrorType =
	| 'network'      // Connection failed, no response
	| 'timeout'      // Request timed out
	| 'validation'   // 4xx client errors
	| 'server'       // 5xx server errors
	| 'http'         // Other HTTP errors
	| 'unknown';     // Unexpected errors

/**
 * Standardized backend error
 * All feature clients throw this error type
 */
export class BackendError extends Error {
	public readonly type: BackendErrorType;
	public readonly detail: string;
	public readonly statusCode?: number;
	public readonly requestId?: string;

	constructor(
		type: BackendErrorType,
		message: string,
		detail: string,
		statusCode?: number,
		requestId?: string
	) {
		super(message);
		this.name = 'BackendError';
		this.type = type;
		this.detail = detail;
		this.statusCode = statusCode;
		this.requestId = requestId;
	}
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
	status: 'ok' | 'healthy';
	version?: string;
	timestamp?: string;
}

/**
 * Base configuration options
 */
export interface BaseClientOptions {
	/** Override backend URL (otherwise uses BackendConfigManager) */
	baseUrl?: string;

	/** Request timeout in milliseconds (default: 30000) */
	timeout?: number;

	/** Feature name for logging (e.g., 'Test Generation', 'Quality') */
	featureName?: string;

	/** Enable request ID injection (default: true) */
	enableRequestId?: boolean;
}

/**
 * Base Backend Client
 *
 * All feature-specific clients inherit from this class.
 */
export abstract class BaseBackendClient {
	protected client: AxiosInstance;
	protected baseUrl: string;
	protected featureName: string;
	private enableRequestId: boolean;

	/**
	 * @param options - Configuration options
	 */
	constructor(options: BaseClientOptions = {}) {
		// Get backend URL from unified config or override
		this.baseUrl = options.baseUrl || BackendConfigManager.getBackendUrl();
		this.featureName = options.featureName || 'Backend';
		this.enableRequestId = options.enableRequestId !== false;

		// Create Axios instance with common configuration
		this.client = axios.create({
			baseURL: this.baseUrl,
			timeout: options.timeout || 30000,
			headers: {
				'Content-Type': 'application/json'
			}
		});

		// Setup interceptors
		this.setupRequestInterceptor();
		this.setupResponseInterceptor();

		console.log(`[LLT ${this.featureName}] Backend client initialized with URL: ${this.baseUrl}`);
	}

	/**
	 * Setup request interceptor
	 * - Logs outgoing requests
	 * - Injects X-Request-ID header for observability
	 */
	private setupRequestInterceptor(): void {
		this.client.interceptors.request.use(
			(config: InternalAxiosRequestConfig) => {
				// Inject X-Request-ID for backend observability (Phase 2)
				if (this.enableRequestId && config.headers) {
					const requestId = randomUUID();
					config.headers['X-Request-ID'] = requestId;
					console.log(
						`[LLT ${this.featureName}] ${config.method?.toUpperCase()} ${config.url} [Request-ID: ${requestId}]`
					);
				} else {
					console.log(
						`[LLT ${this.featureName}] ${config.method?.toUpperCase()} ${config.url}`
					);
				}
				return config;
			},
			(error) => {
				return Promise.reject(error);
			}
		);
	}

	/**
	 * Setup response interceptor
	 * - Logs responses
	 * - Converts errors to standardized BackendError
	 */
	private setupResponseInterceptor(): void {
		this.client.interceptors.response.use(
			(response) => {
				console.log(
					`[LLT ${this.featureName}] Response: ${response.status} ${response.statusText}`
				);
				return response;
			},
			(error) => {
				// Convert to standardized BackendError
				const backendError = this.handleAxiosError(error);
				return Promise.reject(backendError);
			}
		);
	}

	/**
	 * Health check endpoint
	 *
	 * GET /health
	 *
	 * @returns true if backend is healthy
	 */
	async healthCheck(): Promise<boolean> {
		try {
			const response = await this.client.get<HealthCheckResponse>('/health');
			const isHealthy = response.data.status === 'ok' || response.data.status === 'healthy';
			console.log(`[LLT ${this.featureName}] Health check: ${isHealthy ? 'PASS' : 'FAIL'}`);
			return isHealthy;
		} catch (error) {
			console.error(`[LLT ${this.featureName}] Health check failed:`, error);
			return false;
		}
	}

	/**
	 * Update backend URL from configuration
	 * Call this when configuration changes
	 */
	updateBackendUrl(): void {
		const newUrl = BackendConfigManager.getBackendUrl();
		if (newUrl !== this.baseUrl) {
			this.baseUrl = newUrl;
			this.client.defaults.baseURL = newUrl;
			console.log(`[LLT ${this.featureName}] Backend URL updated to: ${newUrl}`);
		}
	}

	/**
	 * Get current backend URL
	 */
	getBackendUrl(): string {
		return this.baseUrl;
	}

	/**
	 * Handle Axios errors and convert to standardized BackendError
	 */
	protected handleAxiosError(error: unknown): BackendError {
		if (!axios.isAxiosError(error)) {
			// Unknown error
			const message = error instanceof Error ? error.message : String(error);
			return new BackendError(
				'unknown',
				'Unknown error occurred',
				message,
				undefined,
				undefined
			);
		}

		const axiosError = error as AxiosError;
		const requestId = axiosError.config?.headers?.['X-Request-ID'] as string | undefined;

		// Network error (no response from server)
		if (!axiosError.response) {
			return new BackendError(
				'network',
				'Cannot connect to backend',
				`Backend unreachable at ${this.baseUrl}. Is the service running?`,
				undefined,
				requestId
			);
		}

		// Timeout error
		if (axiosError.code === 'ECONNABORTED') {
			return new BackendError(
				'timeout',
				'Request timeout',
				'Backend took too long to respond',
				undefined,
				requestId
			);
		}

		// HTTP error responses
		const status = axiosError.response.status;
		const data: any = axiosError.response.data;
		const detail = this.extractErrorDetail(data);

		// Validation errors (4xx)
		if (status >= 400 && status < 500) {
			return new BackendError(
				'validation',
				`Client error: ${status}`,
				detail || `Request validation failed (HTTP ${status})`,
				status,
				requestId
			);
		}

		// Server errors (5xx)
		if (status >= 500) {
			return new BackendError(
				'server',
				`Server error: ${status}`,
				detail || `Backend internal error (HTTP ${status})`,
				status,
				requestId
			);
		}

		// Other HTTP errors
		return new BackendError(
			'http',
			`HTTP error: ${status}`,
			detail || axiosError.message,
			status,
			requestId
		);
	}

	/**
	 * Extract error detail from response data
	 */
	private extractErrorDetail(data: any): string {
		if (!data) {
			return '';
		}

		// FastAPI validation errors
		if (Array.isArray(data.detail)) {
			return data.detail
				.map((err: any) => {
					const field = Array.isArray(err.loc) ? err.loc.join('.') : 'unknown';
					const msg = err.msg || 'invalid value';
					return `${field}: ${msg}`;
				})
				.join('; ');
		}

		// String detail
		if (typeof data.detail === 'string') {
			return data.detail;
		}

		// Generic message
		if (typeof data.message === 'string') {
			return data.message;
		}

		// Fallback to JSON
		try {
			return JSON.stringify(data);
		} catch {
			return String(data);
		}
	}

	/**
	 * Check if error is retryable
	 * Used by subclasses for implementing retry logic
	 */
	protected isRetryableError(error: unknown): boolean {
		if (error instanceof BackendError) {
			// Network, timeout, and server errors are retryable
			return ['network', 'timeout', 'server'].includes(error.type);
		}

		if (axios.isAxiosError(error)) {
			const axiosError = error as AxiosError;

			// Network errors (no response)
			if (!axiosError.response) {
				return true;
			}

			const status = axiosError.response.status;

			// Server errors (5xx)
			if (status >= 500) {
				return true;
			}

			// Rate limiting (429)
			if (status === 429) {
				return true;
			}
		}

		// Timeout errors
		if (error instanceof Error && error.message.includes('timeout')) {
			return true;
		}

		return false;
	}

	/**
	 * Delay helper for retry logic
	 */
	protected delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Execute request with retry logic
	 *
	 * @param fn - Async function to execute
	 * @param maxAttempts - Maximum number of attempts (default: 3)
	 * @param baseDelayMs - Base delay between retries in ms (default: 1000)
	 * @returns Promise with result
	 */
	protected async executeWithRetry<T>(
		fn: () => Promise<T>,
		maxAttempts: number = 3,
		baseDelayMs: number = 1000
	): Promise<T> {
		let lastError: any;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			try {
				return await fn();
			} catch (error) {
				lastError = error;

				// Check if error is retryable
				if (!this.isRetryableError(error)) {
					throw error;
				}

				// Don't retry on last attempt
				if (attempt === maxAttempts - 1) {
					break;
				}

				// Exponential backoff
				const delayMs = Math.pow(2, attempt) * baseDelayMs;
				console.log(
					`[LLT ${this.featureName}] Retry attempt ${attempt + 1}/${maxAttempts} after ${delayMs}ms`
				);
				await this.delay(delayMs);
			}
		}

		throw lastError;
	}
}
