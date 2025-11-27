/**
 * Backend API Client for LLT Quality Analysis
 *
 * ✨ Refactored to use BaseBackendClient
 */

import { BaseBackendClient } from '../../api/baseBackendClient';
import { AsyncTaskPoller } from '../../api/asyncTaskPoller';
import {
	AnalyzeQualityRequest,
	AnalyzeQualityResponse,
	AsyncJobResponse,
	TaskStatusResponse,
	BackendError
} from './types';
import { QUALITY_DEFAULTS } from '../utils/constants';

/**
 * Quality Backend Client
 *
 * Inherits from BaseBackendClient for standardized error handling,
 * health checks, and request management.
 */
export class QualityBackendClient extends BaseBackendClient {
	private taskPoller: AsyncTaskPoller<AnalyzeQualityResponse>;

	constructor() {
		// Initialize base client with feature-specific settings
		super({
			featureName: 'Quality',
			timeout: 30000, // 30 seconds for initial request
			enableRequestId: true
		});

		// Initialize task poller for async operations
		this.taskPoller = new AsyncTaskPoller<AnalyzeQualityResponse>({
			initialIntervalMs: 2000,  // 2 seconds initial poll interval
			maxIntervalMs: 5000,      // 5 seconds max poll interval
			timeoutMs: 120000,        // 2 minutes max wait time for quality analysis
			backoffMultiplier: 1.5,
			jitterFactor: 0.1         // ±10% jitter to prevent thundering herd
		});
	}

	/**
	 * Submit async quality analysis request
	 *
	 * POST /quality/analyze-async
	 * Returns 202 Accepted with task_id for async processing
	 */
	async analyzeQualityAsync(request: AnalyzeQualityRequest): Promise<AsyncJobResponse> {
		// Log full request payload
		console.log('[LLT Quality API] ====================================================================');
		console.log('[LLT Quality API] Async Request Payload:');
		console.log('[LLT Quality API] -------------------------------------------------------------------');
		console.log(`[LLT Quality API] Files count: ${request.files.length}`);
		console.log(`[LLT Quality API] Mode: ${request.mode}`);
		console.log(`[LLT Quality API] Config:`, JSON.stringify(request.config, null, 2));
		console.log('[LLT Quality API] ====================================================================');

		try {
			const response = await this.executeWithRetry(
				async () => {
					const res = await this.client.post<AsyncJobResponse>(
						'/quality/analyze-async',
						request
					);

					// Expect 202 Accepted for async task
					if (res.status === 202 || res.status === 200) {
						return res.data;
					}

					throw new Error(`Unexpected status code: ${res.status}`);
				},
				QUALITY_DEFAULTS.RETRY_MAX_ATTEMPTS,
				QUALITY_DEFAULTS.RETRY_BASE_DELAY_MS
			);

			console.log('[LLT Quality API] Async request submitted successfully');
			console.log(`[LLT Quality API] Task ID: ${response.task_id}`);
			console.log(`[LLT Quality API] Status: ${response.status}`);
			console.log(`[LLT Quality API] Estimated time: ${response.estimated_time_seconds}s`);

			return response;
		} catch (error: any) {
			console.error('[LLT Quality API] ❌ Async request failed:', error);
			throw this.convertToQualityError(error);
		}
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
		} catch (error: any) {
			throw this.convertToQualityError(error);
		}
	}

	/**
	 * Adapter to convert Quality TaskStatusResponse to generic format
	 * Handles the null vs undefined difference in error field
	 */
	private async pollTaskStatusGeneric(taskId: string): Promise<import('../../api/asyncTaskPoller').TaskStatusResponse<AnalyzeQualityResponse>> {
		const status = await this.pollTaskStatus(taskId);

		// Adapter: Convert null error to undefined for AsyncTaskPoller compatibility
		return {
			task_id: status.task_id,
			status: status.status,
			result: status.result,
			error: status.error === null ? undefined : (status.error ? {
				message: status.error.message,
				code: status.error.code || undefined
			} : undefined)
		};
	}

	/**
	 * Poll task status until completion with exponential backoff + jitter
	 *
	 * @param taskId - Task ID to poll
	 * @param onProgress - Optional callback for progress updates
	 * @returns Final quality analysis response
	 */
	async pollTaskUntilComplete(
		taskId: string,
		onProgress?: (status: TaskStatusResponse) => void
	): Promise<AnalyzeQualityResponse> {
		try {
			// Use AsyncTaskPoller for standardized polling with jitter
			const result = await this.taskPoller.poll(
				taskId,
				(id) => this.pollTaskStatusGeneric(id),
				(status) => {
					// Call progress callback if provided
					if (onProgress) {
						onProgress({
							task_id: status.task_id,
							status: status.status,
							created_at: status.created_at,
							updated_at: status.updated_at,
							result: status.result,
							error: status.error || null
						});
					}
				}
			);

			// Log full response
			console.log('[LLT Quality API] ====================================================================');
			console.log('[LLT Quality API] Async Analysis Complete:');
			console.log('[LLT Quality API] -------------------------------------------------------------------');
			console.log(`[LLT Quality API] Analysis ID: ${result.analysis_id}`);
			console.log(`[LLT Quality API] Issues found: ${result.issues.length}`);
			console.log(`[LLT Quality API] Summary:`, JSON.stringify(result.summary, null, 2));

			// Detailed issue logging (same as sync version)
			if (result.issues.length > 0) {
				console.log('[LLT Quality API] -------------------------------------------------------------------');
				console.log('[LLT Quality API] Detailed Issues:');

				result.issues.forEach((issue, index) => {
					console.log(`[LLT Quality API]   Issue #${index + 1}:`);
					console.log(`[LLT Quality API]     file_path: "${issue.file_path}" ✅`);
					console.log(`[LLT Quality API]     line: ${issue.line}`);
					console.log(`[LLT Quality API]     column: ${issue.column}`);
					console.log(`[LLT Quality API]     severity: ${issue.severity}`);
					console.log(`[LLT Quality API]     code: ${issue.code} ✅`);
					console.log(`[LLT Quality API]     message: ${issue.message}`);
					console.log(`[LLT Quality API]     detected_by: ${issue.detected_by}`);
					if (issue.suggestion) {
						console.log(`[LLT Quality API]     suggestion.action: ${issue.suggestion.action || 'N/A'}`);
						console.log(`[LLT Quality API]     suggestion.explanation: ${issue.suggestion.explanation || 'N/A'}`);
						console.log(`[LLT Quality API]     suggestion.new_code: ${issue.suggestion.new_code ? issue.suggestion.new_code.substring(0, 50) + '...' : 'N/A'}`);
					}
					console.log(`[LLT Quality API]     ---`);
				});
			}
			console.log('[LLT Quality API] ====================================================================');

			return result;
		} catch (error: any) {
			console.error('[LLT Quality API] ❌ Async analysis failed:', error);
			throw this.convertToQualityError(error);
		}
	}

	/**
	 * Analyze test files for quality issues (DEPRECATED - use analyzeQualityAsync)
	 *
	 * POST /quality/analyze
	 *
	 * ⚠️ This endpoint is deprecated. Use analyzeQualityAsync() instead for better
	 * handling of large file batches and to prevent timeout issues.
	 */
	async analyzeQuality(request: AnalyzeQualityRequest): Promise<AnalyzeQualityResponse> {
		// Log full request payload
		console.log('[LLT Quality API] ====================================================================');
		console.log('[LLT Quality API] Request Payload:');
		console.log('[LLT Quality API] -------------------------------------------------------------------');
		console.log(`[LLT Quality API] Files count: ${request.files.length}`);
		console.log(`[LLT Quality API] Mode: ${request.mode}`);
		console.log(`[LLT Quality API] Config:`, JSON.stringify(request.config, null, 2));
		console.log('[LLT Quality API] File details:');
		request.files.forEach((file, index) => {
			console.log(`[LLT Quality API]   [${index}] path: "${file.path}", content length: ${file.content.length} chars`);
		});
		console.log('[LLT Quality API] ====================================================================');

		try {
			// Use BaseBackendClient's executeWithRetry for standardized retry logic
			const response = await this.executeWithRetry(
				async () => {
					const res = await this.client.post<AnalyzeQualityResponse>(
						'/quality/analyze',
						request
					);
					return res.data;
				},
				QUALITY_DEFAULTS.RETRY_MAX_ATTEMPTS,
				QUALITY_DEFAULTS.RETRY_BASE_DELAY_MS
			);

			// Log full response
			console.log('[LLT Quality API] ====================================================================');
			console.log('[LLT Quality API] Response Data:');
			console.log('[LLT Quality API] -------------------------------------------------------------------');
			console.log(`[LLT Quality API] Analysis ID: ${response.analysis_id}`);
			console.log(`[LLT Quality API] Issues found: ${response.issues.length}`);
			console.log(`[LLT Quality API] Summary:`, JSON.stringify(response.summary, null, 2));

			// Detailed issue logging with validation
			if (response.issues.length > 0) {
				console.log('[LLT Quality API] -------------------------------------------------------------------');
				console.log('[LLT Quality API] Detailed Issues:');

				response.issues.forEach((issue, index) => {
					console.log(`[LLT Quality API]   Issue #${index + 1}:`);
					console.log(`[LLT Quality API]     file_path: "${issue.file_path}" ✅`);
					console.log(`[LLT Quality API]     line: ${issue.line}`);
					console.log(`[LLT Quality API]     column: ${issue.column}`);
					console.log(`[LLT Quality API]     severity: ${issue.severity}`);
					console.log(`[LLT Quality API]     code: ${issue.code} ✅`);
					console.log(`[LLT Quality API]     message: ${issue.message}`);
					console.log(`[LLT Quality API]     detected_by: ${issue.detected_by}`);
					if (issue.suggestion) {
						console.log(`[LLT Quality API]     suggestion.action: ${issue.suggestion.action || 'N/A'}`);
						console.log(`[LLT Quality API]     suggestion.explanation: ${issue.suggestion.explanation || 'N/A'}`);
						console.log(`[LLT Quality API]     suggestion.new_code: ${issue.suggestion.new_code ? issue.suggestion.new_code.substring(0, 50) + '...' : 'N/A'}`);
					}
					console.log(`[LLT Quality API]     ---`);
				});
			}
			console.log('[LLT Quality API] ====================================================================');

			return response;
		} catch (error: any) {
			console.error('[LLT Quality API] ❌ API call failed:', error);
			// Convert BaseBackendClient errors to Quality BackendError format
			throw this.convertToQualityError(error);
		}
	}

	/**
	 * Convert BaseBackendClient errors to Quality BackendError format
	 * Maintains backward compatibility with existing error handling
	 */
	private convertToQualityError(error: any): BackendError {
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
			message: error.message || 'Unknown error',
			detail: error.detail || String(error),
			statusCode: error.statusCode
		};
	}
}
