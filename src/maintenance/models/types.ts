/**
 * Maintenance Module Types
 * Type definitions for the Dynamic Maintenance feature
 */

/**
 * Maintenance status
 */
export type MaintenanceStatus = 'idle' | 'analyzing' | 'ready' | 'processing' | 'error';

/**
 * Impact level for affected test cases
 */
export type MaintenanceImpactLevel = 'critical' | 'high' | 'medium' | 'low';

/**
 * User decision type
 */
export type UserDecisionType = 'functionality_changed' | 'refactor_only' | 'cancelled';

/**
 * Batch fix action type
 */
export type BatchFixAction = 'regenerate' | 'improve_coverage';

/**
 * Affected test case information
 */
export interface AffectedTestCase {
	test_file: string;
	test_name: string;
	test_class?: string;
	impact_level: MaintenanceImpactLevel;
	reason: string;
	requires_update: boolean;
	line_number?: number;
	source_file?: string;
	source_function?: string;
}

/**
 * Code change information for a single file
 */
export interface CodeChange {
	file_path: string;
	old_content: string;
	new_content: string;
	changed_functions: string[];
	lines_added: number;
	lines_removed: number;
}

/**
 * Code diff information
 */
export interface CodeDiff {
	file_path: string;
	old_content: string;
	new_content: string;
	unified_diff?: string;
	changed_functions: string[];
	lines_added: number;
	lines_removed: number;
}

/**
 * Change summary statistics
 */
export interface ChangeSummary {
	files_changed: number;
	functions_changed: string[];
	lines_added: number;
	lines_removed: number;
	change_type: 'refactor' | 'feature_addition' | 'bug_fix' | 'breaking_change';
}

/**
 * Maintenance analysis result
 */
export interface MaintenanceResult {
	context_id: string;
	commit_hash: string;
	previous_commit_hash: string;
	affected_tests: AffectedTestCase[];
	change_summary: ChangeSummary;
	code_changes: CodeChange[];
	timestamp: number;
}

/**
 * User decision result
 */
export interface UserDecision {
	decision: UserDecisionType;
	user_description?: string; // Only when decision is 'functionality_changed'
	selected_tests?: AffectedTestCase[]; // Selected tests for batch fix
}

/**
 * Batch fix result
 */
export interface BatchFixResult {
	success: boolean;
	processed_count: number;
	success_count: number;
	failed_count: number;
	results: TestFixResult[];
	error?: string;
}

/**
 * Individual test fix result
 */
export interface TestFixResult {
	test: AffectedTestCase;
	success: boolean;
	old_code?: string;
	new_code?: string;
	error?: string;
}

/**
 * Git commit information
 */
export interface GitCommit {
	hash: string;
	short_hash: string;
	message: string;
	author: string;
	timestamp: number;
}

/**
 * Commit comparison result
 */
export interface CommitComparison {
	current_commit: GitCommit;
	previous_commit: GitCommit | null;
	has_changes: boolean;
	changed_files: string[];
}

