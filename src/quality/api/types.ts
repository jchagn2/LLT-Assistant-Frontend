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
 */
export type DetectedBy = 'rule_engine' | 'llm';

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
 */
export interface QualityIssue {
	file: string;
	line: number;
	column: number;
	severity: IssueSeverity;
	type: IssueType;
	message: string;
	detected_by: DetectedBy;
	suggestion: IssueSuggestion;
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
 * Severity breakdown
 */
export interface SeverityBreakdown {
	error: number;
	warning: number;
	info: number;
}

/**
 * Analysis metrics
 */
export interface AnalysisMetrics {
	total_tests: number;
	issues_count: number;
	analysis_time_ms: number;
	rules_applied: string[];
	severity_breakdown?: SeverityBreakdown;
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
 * Analyze quality response
 */
export interface AnalyzeQualityResponse {
	analysis_id: string;
	issues: QualityIssue[];
	metrics: AnalysisMetrics;
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
 * Health check response
 */
export interface HealthCheckResponse {
	status: string;
	version?: string;
}
