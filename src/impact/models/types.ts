/**
 * Impact Analysis Types
 * Type definitions for the Test Impact Analysis feature
 */

/**
 * Impact level severity
 */
export type ImpactLevel = 'critical' | 'high' | 'medium' | 'low';

/**
 * View mode for displaying impact analysis results
 */
export type ViewMode = 'file-to-tests' | 'tests-to-files';

/**
 * Change type classification
 */
export type ChangeType = 'refactor' | 'feature_addition' | 'bug_fix' | 'breaking_change';

/**
 * Affected test information
 */
export interface AffectedTest {
	file_path: string;
	test_name: string;
	impact_level: ImpactLevel;
	reason: string;
	requires_update: boolean;
	line_number?: number;
}

/**
 * Function change information
 */
export interface FunctionChange {
	file_path: string;
	function_name: string;
	change_description: string;
	line_range: [number, number];
}

/**
 * Change summary statistics
 */
export interface ChangeSummary {
	functions_changed: FunctionChange[];
	files_changed_count: number; // Number of files that were modified
	lines_added: number;
	lines_removed: number;
	change_type: ChangeType;
}

/**
 * Code change for a single file
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
 * Change detection result from backend
 */
export interface ChangeDetectionResult {
	context_id: string;
	affected_tests: AffectedTest[];
	changed_files: string[]; // List of all changed file paths
	change_summary: ChangeSummary;
	timestamp: number;
}

/**
 * Mapping from source file to affected tests
 */
export interface FileToTestsMapping {
	[sourceFilePath: string]: {
		functions: FunctionChange[];
		affected_tests: AffectedTest[];
	};
}

/**
 * Mapping from test file to impacting sources
 */
export interface TestToFilesMapping {
	[testFilePath: string]: {
		tests: AffectedTest[];
		impacted_by: FunctionChange[];
	};
}

/**
 * Diff extraction result
 */
export interface DiffResult {
	old_content: string;
	new_content: string;
	changed_functions: string[];
	lines_added: number;
	lines_removed: number;
}

/**
 * Test regeneration result
 */
export interface RegenerationResult {
	test: AffectedTest;
	oldCode: string;
	newCode: string;
}

/**
 * Tree item metadata for file-to-tests view
 */
export interface FileToTestsMetadata {
	functions: FunctionChange[];
	affected_tests: AffectedTest[];
}

/**
 * Tree item metadata for tests-to-files view
 */
export interface TestsToFilesMetadata {
	tests: AffectedTest[];
	impacted_by: FunctionChange[];
}

/**
 * Tree item type
 */
export enum ImpactTreeItemType {
	Summary = 'summary',
	SourceFile = 'sourceFile',
	TestFile = 'testFile',
	Function = 'function',
	Test = 'test',
	AffectedTestsGroup = 'affectedTestsGroup',
	ImpactedByGroup = 'impactedByGroup',
	FilesChangedGroup = 'filesChangedGroup',  // Group showing all changed files
	TestsAffectedGroup = 'testsAffectedGroup', // Group showing all affected tests
	Empty = 'empty'
}
