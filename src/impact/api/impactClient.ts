/**
 * Impact Analysis Backend Client
 * Handles communication with the backend API for impact detection
 */

import * as vscode from 'vscode';
import axios, { AxiosError, AxiosInstance } from 'axios';
import {
	ImpactAnalysisRequest,
	ImpactAnalysisResponse,
	BackendError,
	BackendErrorType,
	HealthCheckResponse
} from './types';

/**
 * Impact Analysis Backend Client
 */
export class ImpactAnalysisClient {
	private axiosInstance: AxiosInstance;
	private backendUrl: string;

	constructor() {
		this.backendUrl = this.getBackendUrl();
		this.axiosInstance = axios.create({
			baseURL: this.backendUrl,
			timeout: 30000, // 30 seconds
			headers: {
				'Content-Type': 'application/json'
			}
		});
	}

	/**
	 * Get backend URL from configuration
	 */
	private getBackendUrl(): string {
		const config = vscode.workspace.getConfiguration('llt-assistant');
		// Use the same backend URL as test generation
		return config.get('backendUrl', 'https://cs5351.efan.dev');
	}

	/**
	 * Update backend URL when configuration changes
	 */
	updateBackendUrl(): void {
		this.backendUrl = this.getBackendUrl();
		this.axiosInstance = axios.create({
			baseURL: this.backendUrl,
			timeout: 30000,
			headers: {
				'Content-Type': 'application/json'
			}
		});
	}

	/**
	 * Get client metadata for tracking
	 */
	private getClientMetadata() {
		return {
			extension_version: vscode.extensions.getExtension('llt-assistant')?.packageJSON?.version || '0.0.1',
			vscode_version: vscode.version,
			platform: process.platform,
			workspace_hash: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath.substring(0, 8) || 'unknown'
		};
	}

	/**
	 * Check backend health
	 */
	async checkHealth(): Promise<boolean> {
		try {
			const response = await this.axiosInstance.get<HealthCheckResponse>('/health');
			return response.data.status === 'ok' || response.data.status === 'healthy';
		} catch (error) {
			console.error('Health check failed:', error);
			return false;
		}
	}

	/**
	 * Detect code changes and get affected tests
	 */
	async detectCodeChanges(
		request: ImpactAnalysisRequest
	): Promise<ImpactAnalysisResponse> {
		try {
			// Add client metadata
			request.client_metadata = this.getClientMetadata();

			// Log the full request payload
			console.log('[Impact Analysis] Request Payload:', JSON.stringify(request, null, 2));

			// Make API call
			const response = await this.axiosInstance.post<ImpactAnalysisResponse>(
				'/analysis/impact',
				request
			);

			// Log the full response object
			console.log('[Impact Analysis] Response Object:', JSON.stringify(response.data, null, 2));

			return response.data;
		} catch (error) {
			// Log the error object
			console.error('[Impact Analysis] Error Object:', error);
			throw this.handleError(error);
		}
	}

	/**
	 * Batch detect changes for multiple files
	 */
	async detectBatchChanges(
		requests: ImpactAnalysisRequest[]
	): Promise<ImpactAnalysisResponse[]> {
		try {
			// Process each request sequentially to avoid overwhelming the backend
			const results: ImpactAnalysisResponse[] = [];

			for (const request of requests) {
				const result = await this.detectCodeChanges(request);
				results.push(result);
			}

			return results;
		} catch (error) {
			throw this.handleError(error);
		}
	}

	/**
	 * Handle API errors
	 */
	private handleError(error: unknown): BackendError {
		if (axios.isAxiosError(error)) {
			const axiosError = error as AxiosError;

			// Network errors
			if (!axiosError.response) {
				return {
					type: 'network' as BackendErrorType,
					message: 'Cannot connect to LLT backend',
					detail: axiosError.message,
					statusCode: 0
				};
			}

			// Timeout errors
			if (axiosError.code === 'ECONNABORTED') {
				return {
					type: 'timeout' as BackendErrorType,
					message: 'Backend request timed out',
					detail: 'The server took too long to respond',
					statusCode: 0
				};
			}

			// HTTP errors
			const statusCode = axiosError.response.status;

			if (statusCode >= 400 && statusCode < 500) {
				// Client errors (validation, etc.)
				return {
					type: 'validation' as BackendErrorType,
					message: 'Invalid request',
					detail: JSON.stringify(axiosError.response.data) || axiosError.message,
					statusCode
				};
			}

			if (statusCode >= 500) {
				// Server errors
				return {
					type: 'server' as BackendErrorType,
					message: 'Backend server error',
					detail: JSON.stringify(axiosError.response.data) || axiosError.message,
					statusCode
				};
			}

			// Other HTTP errors
			return {
				type: 'http' as BackendErrorType,
				message: `HTTP error ${statusCode}`,
				detail: axiosError.message,
				statusCode
			};
		}

		// Unknown errors
		return {
			type: 'unknown' as BackendErrorType,
			message: 'Unknown error occurred',
			detail: error instanceof Error ? error.message : String(error),
			statusCode: 0
		};
	}
}
