/**
 * Backend API Client for Coverage Test Generation
 *
 * ✨ Refactored to use BaseBackendClient and AsyncTaskPoller
 */

import { BaseBackendClient } from '../../api/baseBackendClient';
import { AsyncTaskPoller } from '../../api/asyncTaskPoller';
import {
	CoverageBackendError,
	CoverageOptimizationRequest,
	CoverageOptimizationResult,
	TaskStatusResponse
} from './types';

/**
 * Coverage-specific error class (for backward compatibility)
 */
export class CoverageError extends Error implements CoverageBackendError {
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
	TIMEOUT_MS: 60000, // 60 seconds for test generation (longer than quality analysis)
	RETRY_MAX_ATTEMPTS: 3,
	RETRY_BASE_DELAY_MS: 2000, // 2 seconds
	POLL_INTERVAL_MS: 1000, // 1 second initial poll interval
	MAX_POLL_INTERVAL_MS: 5000, // 5 seconds max poll interval
	MAX_POLL_TIMEOUT_MS: 300000 // 5 minutes max wait time
};

/**
 * Coverage Backend Client
 *
 * Inherits from BaseBackendClient for standardized error handling,
 * health checks, and request management.
 */
export class CoverageBackendClient extends BaseBackendClient {
	private taskPoller: AsyncTaskPoller<CoverageOptimizationResult>;

	constructor() {
		// Initialize base client with feature-specific settings
		super({
			featureName: 'Coverage',
			timeout: DEFAULTS.TIMEOUT_MS,
			enableRequestId: true
		});

		// Initialize task poller with coverage-specific options
		this.taskPoller = new AsyncTaskPoller<CoverageOptimizationResult>({
			initialIntervalMs: DEFAULTS.POLL_INTERVAL_MS,
			maxIntervalMs: DEFAULTS.MAX_POLL_INTERVAL_MS,
			timeoutMs: DEFAULTS.MAX_POLL_TIMEOUT_MS,
			backoffMultiplier: 1.5,
			jitterFactor: 0.1 // ±10% jitter to prevent thundering herd
		});
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
		// Use BaseBackendClient's executeWithRetry for standardized retry logic
		return await this.executeWithRetry(
			async () => {
				const response = await this.client.post<TaskStatusResponse>(
					'/optimization/coverage',
					request
				);

				// Expect 202 Accepted for async task
				if (response.status === 202 || response.status === 200) {
					return response.data;
				}

				throw new Error(`Unexpected status code: ${response.status}`);
			},
			DEFAULTS.RETRY_MAX_ATTEMPTS,
			DEFAULTS.RETRY_BASE_DELAY_MS
		);
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
			// Convert BaseBackendClient errors to CoverageError for backward compatibility
			throw this.convertToCoverageError(error);
		}
	}

	/**
	 * Adapter to convert Coverage TaskStatusResponse to generic format
	 * Handles the null vs undefined difference in error field
	 */
	private async pollTaskStatusGeneric(taskId: string): Promise<import('../../api/asyncTaskPoller').TaskStatusResponse<CoverageOptimizationResult>> {
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
	 * @returns Final task status response
	 */
	async pollTaskUntilComplete(
		taskId: string,
		onProgress?: (status: TaskStatusResponse) => void
	): Promise<TaskStatusResponse> {
		try {
			// Use AsyncTaskPoller for standardized polling with jitter
			const result = await this.taskPoller.poll(
				taskId,
				(id) => this.pollTaskStatusGeneric(id),
				(status) => {
					// Call progress callback if provided (convert back to Coverage TaskStatusResponse)
					if (onProgress) {
						onProgress({
							task_id: status.task_id,
							status: status.status,
							result: status.result,
							error: status.error || null
						});
					}
				}
			);

			// Return full status response with result
			return {
				task_id: taskId,
				status: 'completed',
				result: result
			};
		} catch (error: any) {
			// Convert AsyncTaskPoller errors to CoverageError for backward compatibility
			if (error.name === 'TaskTimeoutError') {
				throw new CoverageError({
					type: 'timeout',
					message: 'Task polling timeout',
					detail: `Task ${taskId} did not complete within ${DEFAULTS.MAX_POLL_TIMEOUT_MS}ms`,
					statusCode: 0
				});
			}
			if (error.name === 'TaskFailedError') {
				throw new CoverageError({
					type: 'server',
					message: `Task failed: ${error.message}`,
					detail: `Task ${taskId} failed during processing`,
					statusCode: 0
				});
			}
			throw this.convertToCoverageError(error);
		}
	}

	/**
	 * Convert BaseBackendClient errors to CoverageError
	 */
	private convertToCoverageError(error: any): CoverageError {
		// If it's already a CoverageError, return it
		if (error instanceof CoverageError) {
			return error;
		}

		// If it's a BackendError from BaseBackendClient, convert it
		if (error.name === 'BackendError') {
			return new CoverageError({
				type: error.type,
				message: error.message,
				detail: error.detail,
				statusCode: error.statusCode
			});
		}

		// Unknown error
		return new CoverageError({
			type: 'unknown',
			message: error.message || 'Unknown error',
			detail: error.detail || String(error),
			statusCode: error.statusCode
		});
	}
}
