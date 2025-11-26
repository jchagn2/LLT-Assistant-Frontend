/**
 * Unit Tests for Quality Tree View Provider
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import { QualityTreeProvider } from '../../../quality/activityBar/provider';
import { TreeItemType } from '../../../quality/activityBar/types';
import {
  createMockAnalysisResponse,
  createMockIssues,
  createMockAnalysisSummary,
} from '../../helpers/factories';
import { resetAllMocks, mockWorkspace } from '../../mocks/vscode';

suite('QualityTreeProvider', () => {
  let provider: QualityTreeProvider;
  let onDidChangeTreeDataSpy: sinon.SinonSpy;

  setup(() => {
    resetAllMocks();

    // Mock configuration
    mockWorkspace.getConfiguration.returns({
      get: sinon.stub().withArgs('severityFilter').returns(['error', 'warning', 'info']),
    });

    provider = new QualityTreeProvider();

    // Spy on tree data change event
    onDidChangeTreeDataSpy = sinon.spy();
    provider.onDidChangeTreeData(onDidChangeTreeDataSpy);
  });

  teardown(() => {
    sinon.restore();
  });

  suite('Initialization', () => {
    test('should start with no analysis result', async () => {
      const result = provider.getAnalysisResult();
      expect(result).to.be.null;
    });

    test('should show empty state when no analysis', async () => {
      const children = await provider.getChildren();

      expect(children.length).to.equal(1);
      expect(children[0].type).to.equal(TreeItemType.Empty);
      expect(children[0].label).to.include('No analysis run yet');
    });
  });

  suite('refresh', () => {
    test('should update analysis result', () => {
      const mockResponse = createMockAnalysisResponse();

      provider.refresh(mockResponse);

      const result = provider.getAnalysisResult();
      expect(result).to.equal(mockResponse);
    });

    test('should fire tree data change event', () => {
      const mockResponse = createMockAnalysisResponse();

      provider.refresh(mockResponse);

      expect(onDidChangeTreeDataSpy.called).to.be.true;
    });

    test('should fire event with undefined to refresh entire tree', () => {
      const mockResponse = createMockAnalysisResponse();

      provider.refresh(mockResponse);

      expect(onDidChangeTreeDataSpy.calledWith(undefined)).to.be.true;
    });
  });

  suite('clear', () => {
    test('should clear analysis result', () => {
      const mockResponse = createMockAnalysisResponse();
      provider.refresh(mockResponse);

      provider.clear();

      const result = provider.getAnalysisResult();
      expect(result).to.be.null;
    });

    test('should fire tree data change event', () => {
      const mockResponse = createMockAnalysisResponse();
      provider.refresh(mockResponse);
      onDidChangeTreeDataSpy.resetHistory();

      provider.clear();

      expect(onDidChangeTreeDataSpy.called).to.be.true;
    });

    test('should return to empty state after clear', async () => {
      const mockResponse = createMockAnalysisResponse();
      provider.refresh(mockResponse);

      provider.clear();

      const children = await provider.getChildren();
      expect(children.length).to.equal(1);
      expect(children[0].type).to.equal(TreeItemType.Empty);
    });
  });

  suite('getChildren - Root Level', () => {
    test('should return summary and file items at root', async () => {
      const mockResponse = createMockAnalysisResponse({
        issues: createMockIssues(5, 'tests/test_example.py'),
      });
      provider.refresh(mockResponse);

      const children = await provider.getChildren();

      // Should have 1 summary + 1 file item
      expect(children.length).to.equal(2);
      expect(children[0].type).to.equal(TreeItemType.Summary);
      expect(children[1].type).to.equal(TreeItemType.File);
    });

    test('should group issues by file', async () => {
      const issues = [
        ...createMockIssues(3, 'tests/test_file1.py'),
        ...createMockIssues(2, 'tests/test_file2.py'),
      ];
      const mockResponse = createMockAnalysisResponse({ issues });
      provider.refresh(mockResponse);

      const children = await provider.getChildren();

      // Should have 1 summary + 2 file items
      expect(children.length).to.equal(3);
      expect(children[0].type).to.equal(TreeItemType.Summary);
      expect(children[1].type).to.equal(TreeItemType.File);
      expect(children[2].type).to.equal(TreeItemType.File);
    });

    test('should include issue counts in file items', async () => {
      const issues = createMockIssues(5, 'tests/test_example.py');
      const mockResponse = createMockAnalysisResponse({ issues });
      provider.refresh(mockResponse);

      const children = await provider.getChildren();
      const fileItem = children.find(c => c.type === TreeItemType.File);

      expect(fileItem).to.exist;
      expect(fileItem!.issueCount).to.equal(5);
      expect(fileItem!.description).to.include('5');
    });
  });

  suite('getChildren - File Level', () => {
    test('should return issue items for a file', async () => {
      const issues = createMockIssues(3, 'tests/test_example.py');
      const mockResponse = createMockAnalysisResponse({ issues });
      provider.refresh(mockResponse);

      const rootChildren = await provider.getChildren();
      const fileItem = rootChildren.find(c => c.type === TreeItemType.File)!;
      const issueItems = await provider.getChildren(fileItem);

      expect(issueItems.length).to.equal(3);
      expect(issueItems.every(item => item.type === TreeItemType.Issue)).to.be.true;
    });

    test('should sort issues by line number', async () => {
      const issues = [
        ...createMockIssues(1, 'tests/test.py'),
        ...createMockIssues(1, 'tests/test.py'),
        ...createMockIssues(1, 'tests/test.py'),
      ];
      // Manually set line numbers out of order
      issues[0].line = 30;
      issues[1].line = 10;
      issues[2].line = 20;

      const mockResponse = createMockAnalysisResponse({ issues });
      provider.refresh(mockResponse);

      const rootChildren = await provider.getChildren();
      const fileItem = rootChildren.find(c => c.type === TreeItemType.File)!;
      const issueItems = await provider.getChildren(fileItem);

      expect(issueItems[0].issue?.line).to.equal(10);
      expect(issueItems[1].issue?.line).to.equal(20);
      expect(issueItems[2].issue?.line).to.equal(30);
    });

    test('should include issue details in labels', async () => {
      const issues = createMockIssues(1, 'tests/test.py');
      const mockResponse = createMockAnalysisResponse({ issues });
      provider.refresh(mockResponse);

      const rootChildren = await provider.getChildren();
      const fileItem = rootChildren.find(c => c.type === TreeItemType.File)!;
      const issueItems = await provider.getChildren(fileItem);

      const issueItem = issueItems[0];
      expect(issueItem.label).to.include('Line');
      expect(issueItem.label).to.include(issueItem.issue!.line.toString());
    });
  });

  suite('getChildren - Issue Level', () => {
    test('should return empty array for issue items', async () => {
      const issues = createMockIssues(1, 'tests/test.py');
      const mockResponse = createMockAnalysisResponse({ issues });
      provider.refresh(mockResponse);

      const rootChildren = await provider.getChildren();
      const fileItem = rootChildren.find(c => c.type === TreeItemType.File)!;
      const issueItems = await provider.getChildren(fileItem);
      const children = await provider.getChildren(issueItems[0]);

      expect(children).to.be.an('array');
      expect(children.length).to.equal(0);
    });
  });

  suite('getTreeItem', () => {
    test('should convert QualityTreeItem to TreeItem', async () => {
      const mockResponse = createMockAnalysisResponse();
      provider.refresh(mockResponse);

      const children = await provider.getChildren();
      const summaryItem = children[0];
      const treeItem = provider.getTreeItem(summaryItem);

      expect(treeItem.label).to.equal(summaryItem.label);
      expect(treeItem.description).to.equal(summaryItem.description);
      expect(treeItem.tooltip).to.equal(summaryItem.tooltip);
    });

    test('should include command for issue items', async () => {
      const issues = createMockIssues(1, 'tests/test.py');
      const mockResponse = createMockAnalysisResponse({ issues });
      provider.refresh(mockResponse);

      const rootChildren = await provider.getChildren();
      const fileItem = rootChildren.find(c => c.type === TreeItemType.File)!;
      const issueItems = await provider.getChildren(fileItem);
      const treeItem = provider.getTreeItem(issueItems[0]);

      expect(treeItem.command).to.exist;
      expect(treeItem.command!.command).to.equal('llt-assistant.showIssue');
    });
  });

  suite('Summary Item', () => {
    test('should display total issues count', async () => {
      const mockResponse = createMockAnalysisResponse({
        summary: createMockAnalysisSummary({
          total_issues: 15,
          total_files: 5,
        }),
      });
      provider.refresh(mockResponse);

      const children = await provider.getChildren();
      const summaryItem = children[0];

      expect(summaryItem.description).to.include('15');
      expect(summaryItem.description).to.include('issues');
    });

    test('should use singular "issue" for count of 1', async () => {
      const mockResponse = createMockAnalysisResponse({
        summary: createMockAnalysisSummary({ total_issues: 1 }),
      });
      provider.refresh(mockResponse);

      const children = await provider.getChildren();
      const summaryItem = children[0];

      expect(summaryItem.description).to.include('1 issue');
      expect(summaryItem.description).to.not.include('issues');
    });

    test('should not be collapsible', async () => {
      const mockResponse = createMockAnalysisResponse();
      provider.refresh(mockResponse);

      const children = await provider.getChildren();
      const summaryItem = children[0];
      const treeItem = provider.getTreeItem(summaryItem);

      expect(treeItem.collapsibleState).to.equal(0); // TreeItemCollapsibleState.None
    });
  });

  suite('File Item', () => {
    test('should display file name without path', async () => {
      const issues = createMockIssues(2, 'tests/unit/quality/test_example.py');
      const mockResponse = createMockAnalysisResponse({ issues });
      provider.refresh(mockResponse);

      const children = await provider.getChildren();
      const fileItem = children.find(c => c.type === TreeItemType.File)!;

      expect(fileItem.label).to.equal('test_example.py');
      expect(fileItem.label).to.not.include('tests/');
    });

    test('should be expanded by default', async () => {
      const issues = createMockIssues(2, 'tests/test.py');
      const mockResponse = createMockAnalysisResponse({ issues });
      provider.refresh(mockResponse);

      const children = await provider.getChildren();
      const fileItem = children.find(c => c.type === TreeItemType.File)!;
      const treeItem = provider.getTreeItem(fileItem);

      expect(treeItem.collapsibleState).to.equal(2); // TreeItemCollapsibleState.Expanded
    });
  });

  suite('Issue Item', () => {
    test('should format issue type correctly', async () => {
      const issues = createMockIssues(1, 'tests/test.py');
      issues[0].type = 'trivial-assertion';
      const mockResponse = createMockAnalysisResponse({ issues });
      provider.refresh(mockResponse);

      const rootChildren = await provider.getChildren();
      const fileItem = rootChildren.find(c => c.type === TreeItemType.File)!;
      const issueItems = await provider.getChildren(fileItem);

      expect(issueItems[0].label).to.include('Trivial Assertion');
    });

    test('should show detection method in description', async () => {
      const issues = createMockIssues(1, 'tests/test.py');
      issues[0].detected_by = 'llm';
      const mockResponse = createMockAnalysisResponse({ issues });
      provider.refresh(mockResponse);

      const rootChildren = await provider.getChildren();
      const fileItem = rootChildren.find(c => c.type === TreeItemType.File)!;
      const issueItems = await provider.getChildren(fileItem);

      expect(issueItems[0].description).to.include('🤖');
    });

    test('should set command to navigate to issue', async () => {
      const issues = createMockIssues(1, 'tests/test.py');
      const mockResponse = createMockAnalysisResponse({ issues });
      provider.refresh(mockResponse);

      const rootChildren = await provider.getChildren();
      const fileItem = rootChildren.find(c => c.type === TreeItemType.File)!;
      const issueItems = await provider.getChildren(fileItem);

      expect(issueItems[0].command).to.exist;
      expect(issueItems[0].command!.arguments).to.deep.equal([issues[0]]);
    });
  });
});
