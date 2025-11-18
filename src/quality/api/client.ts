/**
 * Backend API Client for LLT Quality Analysis
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import * as vscode from 'vscode';
import {
	AnalyzeQualityRequest,
	AnalyzeQualityResponse,
	BackendError,
	HealthCheckResponse
} from './types';

export class QualityBackendClient {
	private client: AxiosInstance;
	private baseUrl: string;

	constructor() {
		this.baseUrl = this.getBackendUrl();
		this.client = axios.create({
			baseURL: this.baseUrl,
			timeout: 30000, // 30 seconds
			headers: {
				'Content-Type': 'application/json'
			}
		});

		this.setupInterceptors();
	}

	/**
	 * Get backend URL from VSCode configuration
	 */
	private getBackendUrl(): string {
		const config = vscode.workspace.getConfiguration('llt-assistant.quality');
		return config.get('backendUrl', 'http://localhost:8000/api/v1');
	}

	/**
	 * Setup request/response interceptors for logging and error handling
	 */
	private setupInterceptors(): void {
		// Request interceptor
		this.client.interceptors.request.use(
			(config) => {
				console.log(`[LLT Quality API] ${config.method?.toUpperCase()} ${config.url}`);
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
					`[LLT Quality API] Response: ${response.status} ${response.statusText}`
				);
				return response;
			},
			(error) => {
				return Promise.reject(this.handleApiError(error));
			}
		);
	}

	/**
	 * Analyze test files for quality issues
	 *
	 * POST /workflows/analyze-quality
	 */
	async analyzeQuality(request: AnalyzeQualityRequest): Promise<AnalyzeQualityResponse> {
		try {
			const response = await this.client.post<AnalyzeQualityResponse>(
				'/workflows/analyze-quality',
				request
			);

			return response.data;
		} catch (error) {
			throw this.handleApiError(error);
		}
	}

	/**
	 * Health check endpoint
	 *
	 * GET /health
	 */
	async healthCheck(): Promise<boolean> {
		try {
			const response = await this.client.get<HealthCheckResponse>('/health');
			return response.status === 200;
		} catch (error) {
			return false;
		}
	}

	/**
	 * Handle API errors and convert to user-friendly messages
	 */
	private handleApiError(error: any): BackendError {
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
				type: 'http',
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
				detail: 'Backend took too long to respond (>30s)',
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
	 * Format FastAPI validation errors into readable message
	 */
	private formatValidationErrors(errors: any[]): string {
		if (!errors || !Array.isArray(errors)) {
			return 'Unknown validation error';
		}

		return errors
			.map(err => {
				const field = err.loc?.join('.') || 'unknown';
				const message = err.msg || 'invalid value';
				return `${field}: ${message}`;
			})
			.join('; ');
	}

	/**
	 * Update backend URL from configuration
	 * Call this when configuration changes
	 */
	public updateBackendUrl(): void {
		const newUrl = this.getBackendUrl();
		if (newUrl !== this.baseUrl) {
			this.baseUrl = newUrl;
			this.client.defaults.baseURL = newUrl;
			console.log(`[LLT Quality API] Backend URL updated to: ${newUrl}`);
		}
	}
}
