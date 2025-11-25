/**
 * LLT Assistant Configuration Constants
 * 
 * Centralized configuration for timing, delays, and constants used throughout the extension.
 * This makes it easy to adjust behaviors and ensures consistency.
 */

// ===== LSP (Language Server Protocol) Configuration =====

/**
 * Initial delay after extension activation before attempting LSP detection.
 * Gives Python Language Server time to initialize.
 * Value: 3000ms (3 seconds)
 */
export const LSP_INITIAL_DELAY_MS = 3000;

/**
 * Base delay for LSP retry attempts. This will be multiplied by 2^retry_count.
 * Value: 500ms
 */
export const LSP_RETRY_BASE_DELAY_MS = 500;

/**
 * Maximum number of LSP retry attempts before giving up.
 * Retry delays: 500ms, 1000ms, 2000ms, 4000ms, 8000ms
 * Total wait time: ~18.5 seconds including initial delay
 */
export const LSP_MAX_RETRIES = 5;

/**
 * Timeout for API requests in milliseconds.
 * Value: 30000ms (30 seconds)
 */
export const API_TIMEOUT_MS = 30000;

/**
 * Shorter timeout for health check requests.
 * Value: 5000ms (5 seconds)
 */
export const HEALTH_CHECK_TIMEOUT_MS = 5000;

// ===== File Processing Configuration =====

/**
 * Number of files to process in a single batch.
 * Larger batches are faster but may block UI longer.
 * Value: 50 files
 */
export const BATCH_SIZE = 50;

/**
 * Debounce delay for file change events before triggering incremental updates.
 * Prevents excessive updates during rapid editing.
 * Value: 2000ms (2 seconds)
 */
export const FILE_CHANGE_DEBOUNCE_MS = 2000;

// ===== Cache Configuration =====

/**
 * Maximum cache age in milliseconds before requiring re-index.
 * Value: 30 days
 */
export const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Current schema version for cache structure.
 * Increment this when changing cache structure to trigger migration.
 * Value: 1
 */
export const CACHE_SCHEMA_VERSION = 1;

// ===== Cleanup and Cancellation =====

/**
 * Delay after cancelling indexing before cleanup completes.
 * Allows ongoing operations to finish gracefully.
 * Value: 1000ms (1 second)
 */
export const CANCEL_CLEANUP_DELAY_MS = 1000;

// ===== Status Display =====

/**
 * Time to show success status bar message before hiding.
 * Value: 2000ms (2 seconds)
 */
export const STATUS_SUCCESS_HIDE_DELAY_MS = 2000;

/**
 * Time to show error status bar message before hiding.
 * Value: 3000ms (3 seconds)
 */
export const STATUS_ERROR_HIDE_DELAY_MS = 3000;
