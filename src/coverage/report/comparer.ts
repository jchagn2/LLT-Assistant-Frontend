/**
 * Coverage Report Comparer
 * Compares before/after coverage reports and generates improvement reports
 */

import * as vscode from 'vscode';
import { CoverageReport, CoverageComparison, CoverageFileData } from '../api/types';

class CoverageComparer {
	/**
	 * Compare two coverage reports
	 */
	static compare(before: CoverageReport, after: CoverageReport): CoverageComparison {
		const improvement = {
			lineCoverageChange: after.overallStats.lineCoverage - before.overallStats.lineCoverage,
			branchCoverageChange:
				after.overallStats.branchCoverage - before.overallStats.branchCoverage,
			percentageChange:
				((after.overallStats.lineCoverage - before.overallStats.lineCoverage) /
					before.overallStats.lineCoverage) *
				100
		};

		const filesImproved = this.findImprovedFiles(before, after);
		const remainingGaps = this.findRemainingGaps(after);

		return {
			before: before.overallStats,
			after: after.overallStats,
			improvement,
			filesImproved,
			remainingGaps
		};
	}

	/**
	 * Find files that improved
	 */
	private static findImprovedFiles(
		before: CoverageReport,
		after: CoverageReport
	): Array<{
		filePath: string;
		beforeCoverage: number;
		afterCoverage: number;
		change: number;
	}> {
		const improved: Array<{
			filePath: string;
			beforeCoverage: number;
			afterCoverage: number;
			change: number;
		}> = [];

		// Create a map of files from before report
		const beforeMap = new Map(before.files.map(f => [f.filePath, f]));

		// Compare with after report
		for (const afterFile of after.files) {
			const beforeFile = beforeMap.get(afterFile.filePath);
			if (beforeFile) {
				const change = afterFile.lineCoverage - beforeFile.lineCoverage;
				if (change > 0) {
					improved.push({
						filePath: afterFile.filePath,
						beforeCoverage: beforeFile.lineCoverage,
						afterCoverage: afterFile.lineCoverage,
						change
					});
				}
			}
		}

		// Sort by improvement (highest first)
		return improved.sort((a, b) => b.change - a.change);
	}

	/**
	 * Find remaining coverage gaps
	 */
	private static findRemainingGaps(report: CoverageReport): CoverageFileData[] {
		return report.files.filter(
			f =>
				f.uncoveredFunctions.length > 0 ||
				f.partiallyCoveredFunctions.length > 0 ||
				f.lineCoverage < 0.8
		);
	}

	/**
	 * Generate markdown report
	 */
	static generateMarkdownReport(comparison: CoverageComparison): string {
		const md: string[] = [];

		md.push('# 🎉 Coverage Improvement Report\n');
		md.push('---\n');
		md.push('## Overall Coverage\n');

		const beforeLine = (comparison.before.lineCoverage * 100).toFixed(1);
		const afterLine = (comparison.after.lineCoverage * 100).toFixed(1);
		const beforeBranch = (comparison.before.branchCoverage * 100).toFixed(1);
		const afterBranch = (comparison.after.branchCoverage * 100).toFixed(1);

		md.push(`**Before**: ${beforeLine}% line coverage, ${beforeBranch}% branch coverage\n`);
		md.push(`**After**: ${afterLine}% line coverage, ${afterBranch}% branch coverage\n`);
		md.push(
			`**Improvement**: +${(comparison.improvement.lineCoverageChange * 100).toFixed(1)}% line, +${(comparison.improvement.branchCoverageChange * 100).toFixed(1)}% branch\n`
		);
		md.push('\n---\n');

		if (comparison.filesImproved.length > 0) {
			md.push('## Files Improved\n');
			for (const file of comparison.filesImproved) {
				const before = (file.beforeCoverage * 100).toFixed(1);
				const after = (file.afterCoverage * 100).toFixed(1);
				const change = ((file.change) * 100).toFixed(1);
				md.push(`✅ **${file.filePath}**: ${before}% → ${after}% (+${change}%)\n`);
			}
			md.push('\n');
		}

		if (comparison.remainingGaps.length > 0) {
			md.push('---\n');
			md.push('## 📌 Remaining Gaps\n');
			for (const file of comparison.remainingGaps) {
				const coverage = (file.lineCoverage * 100).toFixed(1);
				const issues = file.uncoveredFunctions.length + file.partiallyCoveredFunctions.length;
				md.push(`⚠️ **${file.filePath}**: ${coverage}% coverage (${issues} issues)\n`);

				if (file.uncoveredFunctions.length > 0) {
					md.push(`   - ${file.uncoveredFunctions.length} uncovered functions\n`);
				}
				if (file.partiallyCoveredFunctions.length > 0) {
					md.push(`   - ${file.partiallyCoveredFunctions.length} partially covered functions\n`);
				}
			}
		}

		return md.join('');
	}

	/**
	 * Show improvement report in a webview panel
	 */
	static showReport(comparison: CoverageComparison): void {
		const panel = vscode.window.createWebviewPanel(
			'coverageImprovement',
			'Coverage Improvement Report',
			vscode.ViewColumn.One,
			{ enableScripts: true }
		);

		const markdown = this.generateMarkdownReport(comparison);

		panel.webview.html = this.getWebviewContent(markdown, comparison);
	}

	/**
	 * Get webview HTML content
	 */
	private static getWebviewContent(markdown: string, comparison: CoverageComparison): string {
		const beforeLine = (comparison.before.lineCoverage * 100).toFixed(1);
		const afterLine = (comparison.after.lineCoverage * 100).toFixed(1);
		const improvement = ((comparison.improvement.lineCoverageChange) * 100).toFixed(1);

		return `
<!DOCTYPE html>
<html>
<head>
	<style>
		body {
			padding: 20px;
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
		}
		h1 {
			color: var(--vscode-foreground);
			border-bottom: 2px solid var(--vscode-focusBorder);
			padding-bottom: 10px;
		}
		h2 {
			color: var(--vscode-foreground);
			margin-top: 30px;
		}
		.stats-card {
			background: var(--vscode-editorWidget-background);
			border: 1px solid var(--vscode-editorWidget-border);
			border-radius: 8px;
			padding: 20px;
			margin: 20px 0;
		}
		.stats-row {
			display: flex;
			justify-content: space-around;
			gap: 20px;
			margin: 20px 0;
		}
		.stat-box {
			flex: 1;
			text-align: center;
			padding: 15px;
			background: var(--vscode-input-background);
			border-radius: 6px;
		}
		.stat-label {
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			text-transform: uppercase;
			margin-bottom: 8px;
		}
		.stat-value {
			font-size: 32px;
			font-weight: bold;
			color: var(--vscode-foreground);
		}
		.stat-value.positive {
			color: var(--vscode-charts-green);
		}
		.file-list {
			list-style: none;
			padding: 0;
		}
		.file-item {
			padding: 10px;
			margin: 5px 0;
			background: var(--vscode-input-background);
			border-radius: 4px;
		}
		code {
			background: var(--vscode-textCodeBlock-background);
			padding: 2px 6px;
			border-radius: 3px;
		}
	</style>
</head>
<body>
	<h1>🎉 Coverage Improvement Report</h1>

	<div class="stats-card">
		<div class="stats-row">
			<div class="stat-box">
				<div class="stat-label">Before</div>
				<div class="stat-value">${beforeLine}%</div>
			</div>
			<div class="stat-box">
				<div class="stat-label">After</div>
				<div class="stat-value">${afterLine}%</div>
			</div>
			<div class="stat-box">
				<div class="stat-label">Improvement</div>
				<div class="stat-value positive">+${improvement}%</div>
			</div>
		</div>
	</div>

	<div style="white-space: pre-wrap;">${markdown}</div>
</body>
</html>
		`;
	}
}
