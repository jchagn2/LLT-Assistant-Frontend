/**
 * Unit tests for Coverage XML Parser
 * Tests path resolution, XML parsing, and edge cases
 */

import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import { CoverageXmlParser } from '../../../coverage/parser/xmlParser';

suite('CoverageXmlParser', () => {
	let parser: CoverageXmlParser;
	const fixturesDir = path.join(__dirname, 'fixtures');

	setup(() => {
		parser = new CoverageXmlParser({
			minComplexity: 1,
			includeTrivialFunctions: true,
			focusOnBranches: true
		});
	});

	suite('parse', () => {
		test('should parse valid coverage.xml file', async () => {
			const coveragePath = path.join(fixturesDir, 'valid-coverage.xml');
			const workspaceRoot = path.join(__dirname, 'fixtures');

			const report = await parser.parse(coveragePath, workspaceRoot);

			expect(report).to.exist;
			expect(report.overallStats).to.exist;
			expect(report.overallStats.lineCoverage).to.equal(0.5);
			expect(report.overallStats.branchCoverage).to.equal(0.5);
			expect(report.files).to.be.an('array');
			expect(report.files.length).to.be.greaterThan(0);
		});

		test('should handle coverage.xml with nested paths', async () => {
			const coveragePath = path.join(fixturesDir, 'valid-coverage.xml');
			const workspaceRoot = path.join(__dirname, 'fixtures');

			const report = await parser.parse(coveragePath, workspaceRoot);

			// Check that files with nested paths (api/routes/api_module.py) are parsed
			const nestedFile = report.files.find(f => f.filePath.includes('api'));
			expect(nestedFile).to.exist;
		});

		test('should throw error on invalid XML', async () => {
			const invalidXmlContent = '<invalid>xml</broken>';
			const tempFile = path.join(fixturesDir, 'temp-invalid.xml');

			try {
				await fs.promises.writeFile(tempFile, invalidXmlContent);

				try {
					await parser.parse(tempFile);
					expect.fail('Should have thrown an error');
				} catch (error: any) {
					expect(error).to.exist;
				}
			} finally {
				// Cleanup
				try {
					await fs.promises.unlink(tempFile);
				} catch {
					// Ignore cleanup errors
				}
			}
		});
	});

	suite('Path Resolution', () => {
		test('should resolve paths with app/ prefix', async () => {
			// This test simulates the bug we fixed where coverage.xml has "api/v1/debug_routes.py"
			// but the actual file is at "app/api/v1/debug_routes.py"
			const coveragePath = path.join(fixturesDir, 'app-prefix-coverage.xml');

			// Create a temporary workspace structure for testing
			const tempWorkspace = path.join(fixturesDir, 'temp-workspace');
			const appDir = path.join(tempWorkspace, 'app', 'api', 'v1');

			try {
				// Create directory structure
				await fs.promises.mkdir(appDir, { recursive: true });

				// Create a test file at app/api/v1/debug_routes.py
				const testFilePath = path.join(appDir, 'debug_routes.py');
				await fs.promises.writeFile(testFilePath, '# Test file\n');

				// Parse coverage with workspace root
				const report = await parser.parse(coveragePath, tempWorkspace);

				// The parser should resolve "api/v1/debug_routes.py" to "app/api/v1/debug_routes.py"
				const file = report.files.find(f => f.filePath.includes('debug_routes.py'));
				expect(file).to.exist;
				expect(file!.filePath).to.include('app');
				expect(fs.existsSync(file!.filePath)).to.be.true;
			} finally {
				// Cleanup
				try {
					await fs.promises.rm(tempWorkspace, { recursive: true, force: true });
				} catch {
					// Ignore cleanup errors
				}
			}
		});

		test('should resolve absolute paths correctly', async () => {
			const absolutePath = '/absolute/path/to/file.py';
			const xmlContent = `<?xml version="1.0" ?>
<coverage line-rate="0.5" branch-rate="0.5">
	<packages>
		<package name="." line-rate="0.5" branch-rate="0.5">
			<classes>
				<class name="file.py" filename="${absolutePath}" line-rate="0.5" branch-rate="0.5">
					<methods/>
					<lines>
						<line number="1" hits="1"/>
					</lines>
				</class>
			</classes>
		</package>
	</packages>
</coverage>`;

			const report = parser.parseXmlContent(xmlContent);
			expect(report.files[0].filePath).to.equal(absolutePath);
		});

		test('should log warning for unresolved paths', async () => {
			// Test that the parser logs a warning but doesn't crash when file doesn't exist
			const coveragePath = path.join(fixturesDir, 'valid-coverage.xml');
			const nonExistentWorkspace = '/non/existent/workspace';

			// This should not throw, but should log a warning
			const report = await parser.parse(coveragePath, nonExistentWorkspace);
			expect(report).to.exist;
			expect(report.files).to.be.an('array');
		});
	});

	suite('Coverage Statistics', () => {
		test('should extract correct overall statistics', async () => {
			const coveragePath = path.join(fixturesDir, 'valid-coverage.xml');
			const report = await parser.parse(coveragePath);

			expect(report.overallStats.lineCoverage).to.equal(0.5);
			expect(report.overallStats.branchCoverage).to.equal(0.5);
			expect(report.overallStats.coveredLines).to.equal(100);
			expect(report.overallStats.totalLines).to.equal(200);
		});

		test('should extract file-level statistics', async () => {
			const coveragePath = path.join(fixturesDir, 'valid-coverage.xml');
			const report = await parser.parse(coveragePath);

			const testModuleFile = report.files.find(f => f.filePath.includes('test_module.py'));
			expect(testModuleFile).to.exist;
			expect(testModuleFile!.lineCoverage).to.equal(0.5);
			expect(testModuleFile!.branchCoverage).to.equal(0.5);
		});
	});

	suite('Edge Cases', () => {
		test('should handle empty coverage report', () => {
			const emptyXml = `<?xml version="1.0" ?>
<coverage line-rate="1.0" branch-rate="1.0" lines-covered="0" lines-valid="0">
	<packages>
	</packages>
</coverage>`;

			const report = parser.parseXmlContent(emptyXml);
			expect(report.files).to.be.an('array').that.is.empty;
		});

		test('should handle coverage report with no branches', () => {
			const noBranchesXml = `<?xml version="1.0" ?>
<coverage line-rate="1.0" branch-rate="0" lines-covered="10" lines-valid="10">
	<packages>
		<package name="." line-rate="1.0" branch-rate="0">
			<classes>
				<class name="simple.py" filename="simple.py" line-rate="1.0" branch-rate="0">
					<methods/>
					<lines>
						<line number="1" hits="1"/>
						<line number="2" hits="1"/>
					</lines>
				</class>
			</classes>
		</package>
	</packages>
</coverage>`;

			const report = parser.parseXmlContent(noBranchesXml);
			expect(report.overallStats.branchCoverage).to.equal(0);
		});
	});
});
