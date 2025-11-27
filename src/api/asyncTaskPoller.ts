/**
 * Async Task Poller
 *
 * Generic utility for polling async tasks with:
 * - Exponential backoff with jitter (prevents thundering herd)
 * - Timeout handling
 * - Progress callbacks
 * - Type-safe task results
 *
 * Shared by F1 (Test Generation) and F2b (Coverage Optimization)
 */

/**
 * Task status enum
 */
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Generic task status response
 */
export interface TaskStatusResponse<TResult = any> {
	task_id: string;
	status: TaskStatus;
	created_at?: string;
	updated_at?: string;
	result?: TResult;
	error?: {
		message: string;
		code?: string;
	};
}

/**
 * Polling options
 */
export interface PollingOptions {
	/** Initial polling interval in milliseconds (default: 1500ms) */
	initialIntervalMs?: number;

	/** Maximum polling interval in milliseconds (default: 5000ms) */
	maxIntervalMs?: number;

	/** Timeout in milliseconds (default: 60000ms = 60s) */
	timeoutMs?: number;

	/** Exponential backoff multiplier (default: 1.5) */
	backoffMultiplier?: number;

	/** Jitter factor (0-1, default: 0.1 for ±10% randomization) */
	jitterFactor?: number;
}

/**
 * Error thrown when task polling times out
 */
export class TaskTimeoutError extends Error {
	constructor(
		public readonly taskId: string,
		public readonly elapsed: number,
		message?: string
	) {
		super(message || `Task ${taskId} timed out after ${elapsed}ms`);
		this.name = 'TaskTimeoutError';
	}
}

/**
 * Error thrown when task fails
 */
export class TaskFailedError extends Error {
	constructor(
		public readonly taskId: string,
		public readonly errorCode?: string,
		message?: string
	) {
		super(message || `Task ${taskId} failed`);
		this.name = 'TaskFailedError';
	}
}

/**
 * Async Task Poller
 *
 * Polls a backend task until completion with exponential backoff and jitter.
 */
export class AsyncTaskPoller<TResult = any> {
	private options: Required<PollingOptions>;

	/**
	 * @param options - Polling configuration
	 */
	constructor(options: PollingOptions = {}) {
		this.options = {
			initialIntervalMs: options.initialIntervalMs || 1500,
			maxIntervalMs: options.maxIntervalMs || 5000,
			timeoutMs: options.timeoutMs || 60000,
			backoffMultiplier: options.backoffMultiplier || 1.5,
			jitterFactor: options.jitterFactor || 0.1
		};
	}

	/**
	 * Poll task until completion
	 *
	 * @param taskId - Task identifier
	 * @param pollFn - Function to call for each poll (e.g., GET /tasks/{taskId})
	 * @param onProgress - Optional callback for status updates
	 * @returns Promise with final task result
	 * @throws {TaskTimeoutError} If task exceeds timeout
	 * @throws {TaskFailedError} If task fails
	 */
	async poll(
		taskId: string,
		pollFn: (taskId: string) => Promise<TaskStatusResponse<TResult>>,
		onProgress?: (status: TaskStatusResponse<TResult>) => void
	): Promise<TResult> {
		const startTime = Date.now();
		let currentInterval = this.options.initialIntervalMs;

		console.log(
			`[AsyncTaskPoller] Starting polling for task ${taskId} ` +
			`(timeout: ${this.options.timeoutMs}ms, initial interval: ${this.options.initialIntervalMs}ms)`
		);

		while (true) {
			// Check timeout
			const elapsed = Date.now() - startTime;
			if (elapsed > this.options.timeoutMs) {
				console.error(
					`[AsyncTaskPoller] Task ${taskId} timed out after ${elapsed}ms`
				);
				throw new TaskTimeoutError(taskId, elapsed);
			}

			// Poll status
			const status = await pollFn(taskId);

			// Log status transition
			console.log(
				`[AsyncTaskPoller] Task ${taskId} status: ${status.status} (elapsed: ${elapsed}ms)`
			);

			// Call progress callback
			if (onProgress) {
				onProgress(status);
			}

			// Check if task is complete
			if (status.status === 'completed') {
				if (!status.result) {
					throw new Error(`Task ${taskId} completed but no result returned`);
				}
				console.log(
					`[AsyncTaskPoller] Task ${taskId} completed successfully (total time: ${elapsed}ms)`
				);
				return status.result;
			}

			// Check if task failed
			if (status.status === 'failed') {
				const errorMessage = status.error?.message || 'Unknown error';
				const errorCode = status.error?.code;
				console.error(
					`[AsyncTaskPoller] Task ${taskId} failed: ${errorMessage} (code: ${errorCode || 'N/A'})`
				);
				throw new TaskFailedError(taskId, errorCode, errorMessage);
			}

			// Calculate next polling interval with exponential backoff and jitter
			const nextInterval = this.calculateNextInterval(currentInterval);
			console.log(
				`[AsyncTaskPoller] Task ${taskId} still ${status.status}, waiting ${nextInterval}ms before next poll`
			);

			// Wait before next poll
			await this.delay(nextInterval);

			// Update interval for next iteration
			currentInterval = Math.min(
				currentInterval * this.options.backoffMultiplier,
				this.options.maxIntervalMs
			);
		}
	}

	/**
	 * Calculate next polling interval with jitter
	 *
	 * Jitter prevents "thundering herd" problem when many clients poll simultaneously.
	 * Formula: interval ± (interval * jitterFactor * random)
	 *
	 * Example with 1500ms interval and 0.1 jitter:
	 * - Range: 1350ms - 1650ms (±10% randomization)
	 */
	private calculateNextInterval(baseInterval: number): number {
		const jitterRange = baseInterval * this.options.jitterFactor;
		const jitter = (Math.random() * 2 - 1) * jitterRange; // Random value in [-jitterRange, +jitterRange]
		const intervalWithJitter = Math.max(100, baseInterval + jitter); // Ensure minimum 100ms

		return Math.round(intervalWithJitter);
	}

	/**
	 * Delay helper
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Update polling options
	 *
	 * Useful for dynamically adjusting timeout or intervals based on task type.
	 */
	setOptions(options: Partial<PollingOptions>): void {
		this.options = {
			...this.options,
			...options
		};
		console.log('[AsyncTaskPoller] Options updated:', this.options);
	}

	/**
	 * Get current options
	 */
	getOptions(): Required<PollingOptions> {
		return { ...this.options };
	}
}
