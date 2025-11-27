/**
 * API Types for LLT Backend Quality Analysis
 * Based on OpenAPI spec: https://github.com/Efan404/LLT-Assistant-Backend
 */

/**
 * File input for analysis
 */
export interface FileInput {
	path: string;
	content: string;
}

/**
 * Analysis mode
 */
export type AnalysisMode = 'rules-only' | 'llm-only' | 'hybrid';

/**
 * Issue severity level
 */
export type IssueSeverity = 'error' | 'warning' | 'info';

/**
 * Issue type
 */
export type IssueType =
	| 'duplicate-assertion'
	| 'missing-assertion'
	| 'trivial-assertion'
	| 'vague-assertion'
	| 'unused-fixture'
	| 'unused-variable'
	| 'test-mergeability'
	| 'assertion-inadequate'
	| 'naming-unclear'
	| 'code-smell';

/**
 * Detection source
 * Backend API returns "rule" or "llm", not "rule_engine"
 */
export type DetectedBy = 'rule' | 'llm';

/**
 * Suggestion action
 */
export type SuggestionAction = 'remove' | 'replace' | 'add';

/**
 * Issue suggestion
 */
export interface IssueSuggestion {
	action: SuggestionAction;
	explanation: string;
	old_code: string | null;
	new_code: string | null;
}

/**
 * Quality issue
 *
 * ⚠️ IMPORTANT: Backend API uses different field names than internal schema
 * - Backend returns: file_path (not file)
 * - Backend returns: code (not type)
 * - Backend returns: detected_by values: "rule" or "llm" (not "rule_engine")
 *
 * API Contract: POST /quality/analyze response model QualityIssue
 * Source: app/api/v1/schemas.py:367-381 (backend)
 */
export interface QualityIssue {
	file_path: string;        // ✅ Backend field name (not "file")
	line: number;
	column: number;
	severity: IssueSeverity;
	code: string;             // ✅ Backend field name (not "type"), can be any rule code
	message: string;
	detected_by: DetectedBy;  // "rule" or "llm"
	suggestion: IssueSuggestion | null;  // Can be null
}

/**
 * Analysis configuration
 */
export interface AnalysisConfig {
	disabled_rules?: string[];
	focus_on_changed_lines?: boolean;
	llm_temperature?: number;
}

/**
 * Client metadata
 */
export interface ClientMetadata {
	extension_version?: string;
	vscode_version?: string;
	platform?: string;
	workspace_hash?: string;
}

/**
 * Analyze quality request
 */
export interface AnalyzeQualityRequest {
	files: FileInput[];
	mode?: AnalysisMode;
	config?: AnalysisConfig;
	client_metadata?: ClientMetadata;
}

/**
 * Summary of analysis results
 */
export interface AnalysisSummary {
	total_files: number;
	total_issues: number;
	critical_issues: number;
}

/**
 * Analyze quality response
 */
export interface AnalyzeQualityResponse {
	analysis_id: string;
	issues: QualityIssue[];
	summary: AnalysisSummary;
	version_id?: string;
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
 * Task status from async task poller
 */
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Async job response for quality analysis
 * Returned when submitting async analysis request
 */
export interface AsyncJobResponse {
	task_id: string;
	status: TaskStatus;
	estimated_time_seconds?: number;
}

/**
 * Task status response
 * Used for polling task status via GET /tasks/{task_id}
 */
export interface TaskStatusResponse {
	task_id: string;
	status: TaskStatus;
	created_at?: string;
	updated_at?: string;
	result?: AnalyzeQualityResponse;
	error?: {
		message: string;
		code?: string;
	} | null;
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
	status: string;
	version?: string;
}
