/**
 * Coverage XML Parser
 * Parses pytest coverage.xml files to extract coverage information
 */

import * as fs from 'fs';
import * as path from 'path';
import {
	CoverageReport,
	CoverageFileData,
	CoverageStats,
	UncoveredFunction,
	PartiallyCoveredFunction,
	BranchInfo,
	UncoveredRange
} from '../api/types';
import { ParserOptions } from './types';

/**
 * Simple XML parser for coverage.xml
 * Uses regex-based parsing for simplicity (coverage.xml has predictable structure)
 */
export class CoverageXmlParser {
	private options: ParserOptions;

	constructor(options: ParserOptions = {}) {
		this.options = {
			minComplexity: options.minComplexity || 1,
			includeTrivialFunctions: options.includeTrivialFunctions !== false,
			focusOnBranches: options.focusOnBranches !== false
		};
	}

	/**
	 * Parse a coverage.xml file
	 */
	async parse(xmlPath: string, workspaceRoot?: string): Promise<CoverageReport> {
		const xmlContent = await fs.promises.readFile(xmlPath, 'utf-8');
		return this.parseXmlContent(xmlContent, xmlPath, workspaceRoot);
	}

	/**
	 * Parse XML content string
	 */
	parseXmlContent(xmlContent: string, reportPath?: string, workspaceRoot?: string): CoverageReport {
		// Extract overall statistics from root coverage element
		const overallStats = this.extractOverallStats(xmlContent);

		// Extract file-level coverage data
		const files = this.extractFileCoverage(xmlContent, reportPath, workspaceRoot);

		return {
			overallStats,
			files,
			timestamp: new Date(),
			reportPath
		};
	}

	/**
	 * Extract overall coverage statistics
	 */
	private extractOverallStats(xmlContent: string): CoverageStats {
		// Match the root <coverage> tag
		const coverageMatch = xmlContent.match(
			/<coverage[^>]*line-rate="([\d.]+)"[^>]*branch-rate="([\d.]+)"[^>]*lines-covered="([\d]+)"[^>]*lines-valid="([\d]+)"[^>]*>/
		);

		if (!coverageMatch) {
			// Fallback: try simpler pattern
			const simpleMatch = xmlContent.match(
				/<coverage[^>]*line-rate="([\d.]+)"[^>]*branch-rate="([\d.]+)"[^>]*>/
			);

			if (simpleMatch) {
				const lineCoverage = parseFloat(simpleMatch[1]);
				const branchCoverage = parseFloat(simpleMatch[2]);

				return {
					lineCoverage,
					branchCoverage,
					totalLines: 0,
					coveredLines: 0
				};
			}

			throw new Error('Invalid coverage.xml format: missing coverage element');
		}

		const lineCoverage = parseFloat(coverageMatch[1]);
		const branchCoverage = parseFloat(coverageMatch[2]);
		const coveredLines = parseInt(coverageMatch[3], 10);
		const totalLines = parseInt(coverageMatch[4], 10);

		return {
			lineCoverage,
			branchCoverage,
			totalLines,
			coveredLines
		};
	}

	/**
	 * Extract coverage data for all files
	 */
	private extractFileCoverage(xmlContent: string, reportPath?: string, workspaceRoot?: string): CoverageFileData[] {
		const files: CoverageFileData[] = [];

		// Match all <class> elements (each represents a Python file)
		const classRegex = /<class[^>]*filename="([^"]+)"[^>]*line-rate="([\d.]+)"[^>]*branch-rate="([\d.]+)"[^>]*>([\s\S]*?)<\/class>/g;

		let match;
		while ((match = classRegex.exec(xmlContent)) !== null) {
			const rawFilePath = match[1];
			const lineCoverage = parseFloat(match[2]);
			const branchCoverage = parseFloat(match[3]);
			const classContent = match[4];

			// Resolve file path to absolute path
			const filePath = this.resolveFilePath(rawFilePath, reportPath, workspaceRoot);

			// Extract line information
			const lineData = this.extractLineData(classContent);

			// For now, we'll mark functions as uncovered based on line coverage
			// In a real implementation, we'd need to parse the source file to get function boundaries
			const uncoveredFunctions = this.inferUncoveredFunctions(lineData, filePath);
			const partiallyCoveredFunctions = this.inferPartiallyCoveredFunctions(lineData, filePath);

			files.push({
				filePath,
				lineCoverage,
				branchCoverage,
				totalLines: lineData.totalLines,
				coveredLines: lineData.coveredLines,
				uncoveredFunctions,
				partiallyCoveredFunctions
			});
		}

		return files;
	}

	/**
	 * Resolve file path from coverage.xml to absolute path
	 * Handles relative paths relative to coverage.xml location or workspace root
	 * Also tries common Python project structure patterns (app/, src/, etc.)
	 */
	private resolveFilePath(rawPath: string, reportPath?: string, workspaceRoot?: string): string {
		// If already absolute path, return as is
		if (path.isAbsolute(rawPath)) {
			return rawPath;
		}

		// Try resolving relative to coverage.xml location first
		if (reportPath) {
			const reportDir = path.dirname(reportPath);
			const resolvedFromReport = path.resolve(reportDir, rawPath);

			// Check if file exists at this location
			try {
				if (fs.existsSync(resolvedFromReport)) {
					return resolvedFromReport;
				}
			} catch {
				// Continue to next resolution attempt
			}
		}

		// Try multiple path variations with common Python project structures
		if (workspaceRoot) {
			// Common Python project prefixes to try
			const pathVariations = [
				rawPath,                          // Original path
				path.join('app', rawPath),        // Django/FastAPI style (app/)
				path.join('src', rawPath),        // src layout (src/)
				path.join('backend', rawPath),    // Backend folder (backend/)
				path.join('lib', rawPath),        // Library folder (lib/)
			];

			// Try each variation until we find an existing file
			for (const variation of pathVariations) {
				const resolvedPath = path.resolve(workspaceRoot, variation);
				try {
					if (fs.existsSync(resolvedPath)) {
						return resolvedPath;
					}
				} catch {
					// Continue to next variation
				}
			}

			// If no variation exists, log warning and return the original path resolution
			console.warn(`[Coverage] Could not resolve file path: ${rawPath}. Tried variations: ${pathVariations.join(', ')}`);
			return path.resolve(workspaceRoot, rawPath);
		}

		// Fallback: return as-is (might be handled elsewhere)
		return rawPath;
	}

	/**
	 * Extract line-level coverage data
	 */
	private extractLineData(classContent: string): {
		totalLines: number;
		coveredLines: number;
		lines: Array<{ number: number; hits: number; branch: boolean; missingBranches?: string }>;
	} {
		const lines: Array<{ number: number; hits: number; branch: boolean; missingBranches?: string }> = [];

		const lineRegex = /<line[^>]*number="(\d+)"[^>]*hits="(\d+)"[^>]*(?:branch="(true|false)")?[^>]*(?:missing-branches="([^"]*)")?[^>]*\/>/g;

		let match;
		while ((match = lineRegex.exec(classContent)) !== null) {
			const number = parseInt(match[1], 10);
			const hits = parseInt(match[2], 10);
			const branch = match[3] === 'true';
			const missingBranches = match[4];

			lines.push({ number, hits, branch, missingBranches });
		}

		const totalLines = lines.length;
		const coveredLines = lines.filter(l => l.hits > 0).length;

		return { totalLines, coveredLines, lines };
	}

	/**
	 * Infer uncovered functions from line data
	 * Note: This is a simplified version. Full implementation would parse source files.
	 */
	private inferUncoveredFunctions(
		lineData: { lines: Array<{ number: number; hits: number }> },
		filePath: string
	): UncoveredFunction[] {
		const uncoveredFunctions: UncoveredFunction[] = [];
		const uncoveredLines = lineData.lines.filter(l => l.hits === 0).map(l => l.number);

		if (uncoveredLines.length === 0) {
			return [];
		}

		// Group consecutive uncovered lines into potential functions
		const groups: number[][] = [];
		let currentGroup: number[] = [];

		for (let i = 0; i < uncoveredLines.length; i++) {
			const line = uncoveredLines[i];

			if (currentGroup.length === 0) {
				currentGroup.push(line);
			} else {
				const lastLine = currentGroup[currentGroup.length - 1];
				if (line - lastLine <= 2) { // Allow 1-line gap
					currentGroup.push(line);
				} else {
					if (currentGroup.length >= 3) { // Only consider groups of 3+ lines as functions
						groups.push([...currentGroup]);
					}
					currentGroup = [line];
				}
			}
		}

		if (currentGroup.length >= 3) {
			groups.push(currentGroup);
		}

		// Create UncoveredFunction objects
		groups.forEach((group, index) => {
			uncoveredFunctions.push({
				name: `uncovered_block_${index + 1}`, // Placeholder name
				startLine: group[0],
				endLine: group[group.length - 1]
			});
		});

		return uncoveredFunctions;
	}

	/**
	 * Infer partially covered functions from line data
	 */
	private inferPartiallyCoveredFunctions(
		lineData: {
			lines: Array<{ number: number; hits: number; branch: boolean; missingBranches?: string }>;
		},
		filePath: string
	): PartiallyCoveredFunction[] {
		const partiallyCoveredFunctions: PartiallyCoveredFunction[] = [];

		// Find lines with missing branches
		const linesWithMissingBranches = lineData.lines.filter(
			l => l.branch && l.missingBranches
		);

		if (linesWithMissingBranches.length === 0) {
			return [];
		}

		// Group lines with missing branches
		const uncoveredBranches: BranchInfo[] = linesWithMissingBranches.map(line => ({
			line: line.number,
			type: this.inferBranchType(line.missingBranches || ''),
			description: `Branch not covered: ${line.missingBranches}`
		}));

		if (uncoveredBranches.length > 0) {
			// Group branches by proximity
			const groups = this.groupBranchesByProximity(uncoveredBranches);

			groups.forEach((branches, index) => {
				partiallyCoveredFunctions.push({
					name: `partially_covered_${index + 1}`,
					startLine: Math.min(...branches.map(b => b.line)),
					endLine: Math.max(...branches.map(b => b.line)),
					uncoveredBranches: branches
				});
			});
		}

		return partiallyCoveredFunctions;
	}

	/**
	 * Infer branch type from missing branches string
	 */
	private inferBranchType(missingBranches: string): BranchInfo['type'] {
		if (missingBranches.includes('else')) {
			return 'else';
		}
		if (missingBranches.includes('except')) {
			return 'except';
		}
		if (missingBranches.includes('elif')) {
			return 'elif';
		}
		return 'if';
	}

	/**
	 * Group branches by proximity (within 10 lines)
	 */
	private groupBranchesByProximity(branches: BranchInfo[]): BranchInfo[][] {
		if (branches.length === 0) {
			return [];
		}

		const sorted = [...branches].sort((a, b) => a.line - b.line);
		const groups: BranchInfo[][] = [];
		let currentGroup: BranchInfo[] = [sorted[0]];

		for (let i = 1; i < sorted.length; i++) {
			const current = sorted[i];
			const last = currentGroup[currentGroup.length - 1];

			if (current.line - last.line <= 10) {
				currentGroup.push(current);
			} else {
				groups.push([...currentGroup]);
				currentGroup = [current];
			}
		}

		groups.push(currentGroup);
		return groups;
	}

	/**
	 * Extract uncovered ranges from XML content for a specific file
	 * Returns UncoveredRange[] format suitable for optimization API
	 *
	 * @param classContent - XML content for a single class/file
	 * @returns Array of uncovered ranges (lines and branches)
	 */
	extractUncoveredRanges(classContent: string): UncoveredRange[] {
		const ranges: UncoveredRange[] = [];
		const lineData = this.extractLineData(classContent);

		// Extract uncovered lines (hits = 0)
		const uncoveredLines = lineData.lines
			.filter(l => l.hits === 0)
			.map(l => l.number)
			.sort((a, b) => a - b);

		// Group consecutive uncovered lines into ranges
		if (uncoveredLines.length > 0) {
			const lineRanges = this.groupConsecutiveLines(uncoveredLines);
			for (const range of lineRanges) {
				ranges.push({
					start_line: range.start,
					end_line: range.end,
					type: 'line'
				});
			}
		}

		// Extract uncovered branches (branch=true and missing-branches exists)
		const uncoveredBranches = lineData.lines
			.filter(l => l.branch && l.missingBranches)
			.map(l => l.number)
			.sort((a, b) => a - b);

		// Group consecutive uncovered branches into ranges
		if (uncoveredBranches.length > 0) {
			const branchRanges = this.groupConsecutiveLines(uncoveredBranches);
			for (const range of branchRanges) {
				ranges.push({
					start_line: range.start,
					end_line: range.end,
					type: 'branch'
				});
			}
		}

		return ranges;
	}

	/**
	 * Group consecutive line numbers into ranges
	 * Allows gaps of up to 1 line between consecutive numbers
	 *
	 * @param lines - Sorted array of line numbers
	 * @returns Array of {start, end} ranges
	 */
	private groupConsecutiveLines(lines: number[]): Array<{ start: number; end: number }> {
		if (lines.length === 0) {
			return [];
		}

		const ranges: Array<{ start: number; end: number }> = [];
		let rangeStart = lines[0];
		let rangeEnd = lines[0];

		for (let i = 1; i < lines.length; i++) {
			const currentLine = lines[i];
			// Allow gap of 1 line (consecutive or adjacent)
			if (currentLine - rangeEnd <= 2) {
				rangeEnd = currentLine;
			} else {
				// End current range and start new one
				ranges.push({ start: rangeStart, end: rangeEnd });
				rangeStart = currentLine;
				rangeEnd = currentLine;
			}
		}

		// Add final range
		ranges.push({ start: rangeStart, end: rangeEnd });

		return ranges;
	}
}

/**
 * Find coverage.xml file in workspace
 */
export async function findCoverageFile(workspaceRoot: string): Promise<string | null> {
	const possiblePaths = [
		path.join(workspaceRoot, 'coverage.xml'),
		path.join(workspaceRoot, '.coverage.xml'),
		path.join(workspaceRoot, 'htmlcov', 'coverage.xml'),
		path.join(workspaceRoot, 'coverage', 'coverage.xml'),
		path.join(workspaceRoot, '.pytest_cache', 'coverage.xml')
	];

	for (const filePath of possiblePaths) {
		try {
			await fs.promises.access(filePath, fs.constants.R_OK);
			return filePath;
		} catch {
			// File doesn't exist or not readable, continue
		}
	}

	return null;
}
