/**
 * Impact Analysis Backend Client
 * Handles communication with the backend API for impact detection
 *
 * ✨ Refactored to use BaseBackendClient
 */

import * as vscode from 'vscode';
import { BaseBackendClient } from '../../api/baseBackendClient';
import {
	ImpactAnalysisRequest,
	ImpactAnalysisResponse,
	BackendError
} from './types';

/**
 * Impact Analysis Backend Client
 *
 * Inherits from BaseBackendClient for standardized error handling,
 * health checks, and request management.
 */
export class ImpactAnalysisClient extends BaseBackendClient {
	constructor() {
		// Initialize base client with feature-specific settings
		super({
			featureName: 'Impact Analysis',
			timeout: 30000, // 30 seconds
			enableRequestId: true
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
	 * @deprecated Use healthCheck() from BaseBackendClient instead
	 */
	async checkHealth(): Promise<boolean> {
		return await this.healthCheck();
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
			const response = await this.client.post<ImpactAnalysisResponse>(
				'/analysis/impact',
				request
			);

			// Log the full response object
			console.log('[Impact Analysis] Response Object:', JSON.stringify(response.data, null, 2));

			return response.data;
		} catch (error: any) {
			// Convert BaseBackendClient errors to Impact BackendError format
			throw this.convertToImpactError(error);
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
		} catch (error: any) {
			throw this.convertToImpactError(error);
		}
	}

	/**
	 * Convert BaseBackendClient errors to Impact BackendError format
	 * Maintains backward compatibility with existing error handling
	 */
	private convertToImpactError(error: any): BackendError {
		// If it's already a BackendError from BaseBackendClient
		if (error.name === 'BackendError') {
			return {
				type: error.type,
				message: error.message,
				detail: error.detail,
				statusCode: error.statusCode
			};
		}

		// Unknown error
		return {
			type: 'unknown',
			message: error.message || 'Unknown error occurred',
			detail: error.detail || (error instanceof Error ? error.message : String(error)),
			statusCode: error.statusCode || 0
		};
	}
}
