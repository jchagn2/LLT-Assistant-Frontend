/**
 * Maintenance Backend API Types
 * Type definitions for API requests and responses
 */

import { AffectedTestCase, ChangeSummary, CodeChange } from '../models/types';

/**
 * Client metadata for tracking
 */
export interface ClientMetadata {
	extension_version?: string;
	vscode_version?: string;
	platform?: string;
	workspace_hash?: string;
}

/**
 * Request payload for analyze-maintenance endpoint
 */
export interface AnalyzeMaintenanceRequest {
	commit_hash: string;
	previous_commit_hash: string;
	changes: CodeChange[];
	client_metadata?: ClientMetadata;
}

/**
 * Response from analyze-maintenance endpoint
 */
export interface AnalyzeMaintenanceResponse {
	context_id: string;
	affected_tests: AffectedTestCase[];
	change_summary: ChangeSummary;
}

/**
 * Batch fix request payload
 */
export interface BatchFixRequest {
	action: 'regenerate' | 'improve_coverage';
	tests: Array<{
		test_file: string;
		test_name: string;
		test_class?: string;
		function_name: string;
		source_file: string;
	}>;
	user_description?: string; // Required when action is 'regenerate'
	client_metadata?: ClientMetadata;
}

/**
 * Batch fix response
 */
export interface BatchFixResponse {
	success: boolean;
	processed_count: number;
	results: Array<{
		test_file: string;
		test_name: string;
		success: boolean;
		new_code?: string;
		error?: string;
	}>;
}

/**
 * Code diff request payload
 */
export interface GetCodeDiffRequest {
	file_path: string;
	old_content: string;
	new_content: string;
}

/**
 * Code diff response
 */
export interface GetCodeDiffResponse {
	unified_diff: string;
	changed_functions: string[];
	lines_added: number;
	lines_removed: number;
}

/**
 * Backend error types
 */
export type BackendErrorType =
	| 'network'
	| 'validation'
	| 'server'
	| 'http'
	| 'timeout'
	| 'unknown';

/**
 * Backend error
 */
export interface BackendError {
	type: BackendErrorType;
	message: string;
	detail: string;
	statusCode: number;
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
	status: string;
	version?: string;
}

