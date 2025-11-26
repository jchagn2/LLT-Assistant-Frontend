/**
 * API Types for Coverage Optimization Feature
 * Backend API integration types for coverage test generation
 */

/**
 * Branch information for uncovered code paths
 */
export interface BranchInfo {
	line: number;
	type: 'if' | 'else' | 'except' | 'elif' | 'while' | 'for';
	description: string;
	condition?: string;
}

/**
 * Uncovered function information
 */
export interface UncoveredFunction {
	name: string;
	startLine: number;
	endLine: number;
	complexity?: number;
	code?: string;
}

/**
 * Partially covered function information
 */
export interface PartiallyCoveredFunction {
	name: string;
	startLine: number;
	endLine: number;
	uncoveredBranches: BranchInfo[];
	code?: string;
}

/**
 * Coverage data for a single file
 */
export interface CoverageFileData {
	filePath: string;
	lineCoverage: number;
	branchCoverage: number;
	totalLines: number;
	coveredLines: number;
	uncoveredFunctions: UncoveredFunction[];
	partiallyCoveredFunctions: PartiallyCoveredFunction[];
}

/**
 * Overall coverage statistics
 */
export interface CoverageStats {
	lineCoverage: number;
	branchCoverage: number;
	totalLines: number;
	coveredLines: number;
	totalBranches?: number;
	coveredBranches?: number;
}

/**
 * Complete coverage report
 */
export interface CoverageReport {
	overallStats: CoverageStats;
	files: CoverageFileData[];
	timestamp?: Date;
	reportPath?: string;
}

/**
 * Coverage comparison result
 */
export interface CoverageComparison {
	before: CoverageStats;
	after: CoverageStats;
	improvement: {
		lineCoverageChange: number;
		branchCoverageChange: number;
		percentageChange: number;
	};
	filesImproved: Array<{
		filePath: string;
		beforeCoverage: number;
		afterCoverage: number;
		change: number;
	}>;
	remainingGaps: CoverageFileData[];
}

/**
 * Coverage analysis mode
 */
export type CoverageAnalysisMode = 'function' | 'branch' | 'mixed';

/**
 * Backend error for coverage operations
 */
export interface CoverageBackendError {
	type: 'network' | 'validation' | 'server' | 'timeout' | 'unknown';
	message: string;
	detail: string;
	statusCode?: number;
}

/**
 * Uncovered range information (lines or branches)
 */
export interface UncoveredRange {
	start_line: number;
	end_line: number;
	type: 'line' | 'branch';
}

/**
 * Debug options for testing error handling
 * Backend will simulate errors when these options are set
 */
export interface DebugOptions {
	simulate_error?: boolean;
	error_message?: string;
	error_code?: string | null;
}

/**
 * Coverage optimization request
 */
export interface CoverageOptimizationRequest {
	source_code: string;
	existing_test_code: string;
	uncovered_ranges: UncoveredRange[];
	framework: string;
	debug_options?: DebugOptions;
}

/**
 * Recommended test from optimization result
 */
export interface RecommendedTest {
	test_code: string;
	target_line: number;
	scenario_description: string;
	expected_coverage_impact: string;
}

/**
 * Coverage optimization result
 */
export interface CoverageOptimizationResult {
	recommended_tests: RecommendedTest[];
}

/**
 * Task error response from backend
 */
export interface TaskError {
	message: string;
	code?: string | null;
}

/**
 * Task status response for async operations
 */
export interface TaskStatusResponse {
	task_id: string;
	status: 'pending' | 'processing' | 'completed' | 'failed';
	estimated_time_seconds?: number;
	result?: CoverageOptimizationResult;
	error?: TaskError | null;
}
