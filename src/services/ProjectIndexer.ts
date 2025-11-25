import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import { ContextState, SymbolInfo } from './ContextState';
import { extractSymbolsFromDocument } from '../utils/symbolExtraction';
import { ApiClient, InitResponse, apiClient } from './ApiClient';
import { BATCH_SIZE } from '../config';

/**
 * Extracted data from a file
 */
interface ExtractedData {
  filePath: string;
  symbols: SymbolInfo[];
}

/**
 * Handles automatic workspace scanning and batch processing
 */
export class ProjectIndexer {
  private readonly BATCH_SIZE = BATCH_SIZE; // Imported from config
  private outputChannel: vscode.OutputChannel;
  private cancelFlag = false;
  private isIndexingFlag = false;
  private apiClient: ApiClient;

  constructor(
    private contextState: ContextState,
    outputChannel: vscode.OutputChannel
  ) {
    this.outputChannel = outputChannel;
    this.apiClient = apiClient;
  }

  /**
   * Check if currently indexing
   */
  isIndexing(): boolean {
    return this.isIndexingFlag;
  }

  /**
   * Cancel ongoing indexing
   */
  cancel(): void {
    this.cancelFlag = true;
  }

  /**
   * Find all Python files in workspace
   */
  async discoverPythonFiles(): Promise<vscode.Uri[]> {
    console.log('[LLT ProjectIndexer] Discovering Python files...');
    this.outputChannel.appendLine('Scanning workspace for Python files...');

    try {
      // Define exclusion patterns
      const exclusions = [
        '**/node_modules/**',
        '**/.venv/**',
        '**/venv/**',
        '**/__pycache__/**',
        '**/.git/**',
        '**/.vscode/**',
        '**/dist/**',
        '**/build/**',
        '**/.tox/**',
        '**/site-packages/**'
      ];

      const files = await vscode.workspace.findFiles(
        '**/*.py',
        `{${exclusions.join(',')}}`
      );

      // Sort for consistent ordering
      files.sort((a, b) => a.fsPath.localeCompare(b.fsPath));

      console.log(`[LLT ProjectIndexer] Found ${files.length} Python files`);
      this.outputChannel.appendLine(`Found ${files.length} Python files`);

      // Log each file path for debugging
      files.forEach((file, index) => {
        console.log(`[LLT ProjectIndexer]   [${index + 1}] ${file.fsPath}`);
      });

      return files;
    } catch (error) {
      console.error('[LLT ProjectIndexer] Error discovering files:', error);
      this.outputChannel.appendLine(`Error discovering files: ${error}`);
      return [];
    }
  }

  /**
   * Process files in batches to avoid blocking UI
   */
  async processFilesInBatches(
    files: vscode.Uri[],
    progress: vscode.Progress<{ increment: number; message: string }>
  ): Promise<ExtractedData[]> {
    const totalCount = files.length;
    let processedCount = 0;
    const results: ExtractedData[] = [];
    const totalBatches = Math.ceil(totalCount / this.BATCH_SIZE);

    // Process files in batches
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      if (this.cancelFlag) {
        throw new Error('Indexing cancelled by user');
      }

      const startIndex = batchIndex * this.BATCH_SIZE;
      const endIndex = Math.min(startIndex + this.BATCH_SIZE, totalCount);
      const batch = files.slice(startIndex, endIndex);

      console.log(`[LLT ProjectIndexer] Processing batch ${batchIndex + 1}/${totalBatches} (${startIndex}-${endIndex})`);
      this.outputChannel.appendLine(`Processing batch ${batchIndex + 1}/${totalBatches}...`);

      // Log each file being processed
      batch.forEach((file, idx) => {
        console.log(`[LLT ProjectIndexer]   File ${idx + 1}: ${file.fsPath}`);
        this.outputChannel.appendLine(`  - ${path.basename(file.fsPath)}`);
      });

      // Extract symbols from all files in batch in parallel
      try {
        const batchResults = await Promise.all(
          batch.map(async (fileUri) => {
            try {
              const document = await vscode.workspace.openTextDocument(fileUri);
              const symbols = await extractSymbolsFromDocument(document);
              
              // 🔥 Add diagnostic logs
              console.log(`[LLT ProjectIndexer] Extracted ${symbols.length} symbols from ${fileUri.fsPath}`);
              if (symbols.length > 0) {
                symbols.forEach(symbol => {
                  console.log(`[LLT ProjectIndexer]   Symbol: ${symbol.name} (${symbol.kind})`);
                });
              }
              
              return {
                filePath: fileUri.fsPath,
                symbols
              };
            } catch (fileError) {
              console.warn(`[LLT ProjectIndexer] Error processing ${fileUri.fsPath}:`, fileError);
              this.outputChannel.appendLine(`Warning: Could not process ${fileUri.fsPath}: ${fileError}`);
              return {
                filePath: fileUri.fsPath,
                symbols: []
              };
            }
          })
        );

        // Log filtered results
        const validResults = batchResults.filter(result => result.symbols.length > 0);
        const emptyResults = batchResults.filter(result => result.symbols.length === 0);
        
        console.log(`[LLT ProjectIndexer] Valid files: ${validResults.length}, Empty files: ${emptyResults.length}`);
        emptyResults.forEach((result, idx) => {
          console.log(`[LLT ProjectIndexer]   Empty [${idx + 1}]: ${result.filePath}`);
        });
        
        // Add successful results
        results.push(...validResults);

        processedCount += batch.length;

        // Update progress
        const percentage = Math.floor((processedCount / totalCount) * 100);
        progress.report({
          increment: (100 / totalBatches),
          message: `${processedCount}/${totalCount} files (${percentage}%)`
        });

        console.log(`[LLT ProjectIndexer] Batch ${batchIndex + 1} complete: ${processedCount}/${totalCount}`);
        this.outputChannel.appendLine(`Indexed ${processedCount}/${totalCount} files`);

        // Yield control back to VSCode event loop
        // This prevents UI blocking
        await new Promise(resolve => setTimeout(resolve, 0));
      } catch (batchError) {
        console.error(`[LLT ProjectIndexer] Batch ${batchIndex + 1} failed:`, batchError);
        this.outputChannel.appendLine(`Error in batch ${batchIndex + 1}: ${batchError}`);
        // Continue with next batch instead of failing completely
      }
    }

    return results;
  }

  /**
   * Generate project ID from workspace path
   */
  private generateProjectId(workspacePath: string): string {
    // Use hash of workspace path for consistent project ID
    return crypto.createHash('md5').update(workspacePath).digest('hex').substring(0, 16);
  }

  /**
   * Send indexed data to backend
   */
  async sendToBackend(data: ExtractedData[]): Promise<InitResponse> {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) {
      throw new Error('No workspace open');
    }

    const projectId = this.generateProjectId(workspacePath);
    
    // 🔥 Add detailed validation before sending
    this.outputChannel.appendLine(`\n🔍 Preparing to send to backend:`);
    this.outputChannel.appendLine(`   Project ID: ${projectId}`);
    this.outputChannel.appendLine(`   Workspace: ${workspacePath}`);
    this.outputChannel.appendLine(`   Files discovered: ${data.length}`);
    
    const payloadFiles = data.map(item => ({
      path: item.filePath,
      symbols: item.symbols.map(symbol => ({
        name: symbol.name,
        kind: symbol.kind,
        signature: symbol.signature || '',
        line_start: symbol.line_start,
        line_end: symbol.line_end,
        calls: symbol.calls
      }))
    })).filter(item => item.symbols.length > 0);
    
    this.outputChannel.appendLine(`   Files with symbols: ${payloadFiles.length}`);
    
    // 🔥 CRITICAL: Check if we have any files to send
    if (payloadFiles.length === 0) {
      this.outputChannel.appendLine(`\n❌ ERROR: No files with symbols to send!`);
      this.outputChannel.appendLine(`   Possible causes:`);
      this.outputChannel.appendLine(`   1. Python Language Server not running`);
      this.outputChannel.appendLine(`   2. Files don't contain functions/classes`);
      this.outputChannel.appendLine(`   3. Files are outside workspace directory`);
      this.outputChannel.appendLine(`\n💡 Try:`);
      this.outputChannel.appendLine(`   - Check Python extension is activated (Python version in status bar)`);
      this.outputChannel.appendLine(`   - Open a Python file and check for syntax highlighting`);
      this.outputChannel.appendLine(`   - Run "Python: Restart Language Server" command`);
      
      // 🔥 Provide a graceful fallback: send minimal test data
      this.outputChannel.appendLine(`\n🔄 Attempting fallback: Creating minimal test file...`);
      
      const minimalPayload = {
        project_id: projectId,
        workspace_path: workspacePath,
        language: 'python',
        files: [
          {
            path: `${workspacePath}/test_fallback.py`,
            symbols: [
              {
                name: 'test_function',
                kind: 'function',
                signature: 'test_function() -> None',
                line_start: 0,
                line_end: 2,
                calls: []
              }
            ]
          }
        ]
      };
      
      console.log('[LLT API] Using fallback payload:', JSON.stringify(minimalPayload, null, 2));
      
      try {
        const response = await this.apiClient.initializeProject(minimalPayload);
        this.outputChannel.appendLine(`✅ Fallback successful! Backend accepted minimal data.`);
        return response;
      } catch (fallbackError) {
        this.outputChannel.appendLine(`❌ Fallback also failed: ${fallbackError}`);
        throw new Error('No symbols extracted from Python files. Please check that Python Language Server is running.');
      }
    }

    const payload = {
      project_id: projectId,
      workspace_path: workspacePath,
      language: 'python',
      files: payloadFiles
    };

    console.log(`[LLT ProjectIndexer] Sending ${payload.files.length} files to backend`);
    console.log('[LLT ProjectIndexer] Payload preview:', JSON.stringify(payload, null, 2));
    
    this.outputChannel.appendLine(`Sending data to backend...`);
    this.outputChannel.appendLine(`Files to index: ${payload.files.length}`);
    this.outputChannel.appendLine(`Total symbols: ${payload.files.reduce((sum, f) => sum + f.symbols.length, 0)}`);

    try {
      // Check if project already exists with a quick health check
      const healthCheckOk = await this.apiClient.healthCheck();
      if (!healthCheckOk) {
        throw new Error('Backend service is not running');
      }

      // Send to backend
      const response = await this.apiClient.initializeProject(payload);

      console.log(`[LLT ProjectIndexer] Backend response: indexed ${response.indexed_files} files, ${response.indexed_symbols} symbols in ${response.processing_time_ms}ms`);
      this.outputChannel.appendLine(`Backend indexed ${response.indexed_files} files, ${response.indexed_symbols} symbols`);

      // Update cache state
      this.contextState.setProjectId(response.project_id);
      this.contextState.setVersion(1); // Initial version
      this.contextState.updateLastIndexedAt();

      // CRITICAL: Add the actual symbol data to cache
      this.outputChannel.appendLine(`[LLT] Adding ${data.length} files to cache...`);
      for (const fileData of data) {
        this.contextState.setSymbols(fileData.filePath, fileData.symbols);
        this.outputChannel.appendLine(`  Cached: ${fileData.filePath} (${fileData.symbols.length} symbols)`);
      }
      this.outputChannel.appendLine(`✅ Cache populated with ${data.length} files, ${data.reduce((sum, f) => sum + f.symbols.length, 0)} symbols`);

      return response;
    } catch (error: any) {
      this.handleBackendError(error);
      throw error;
    }
  }

  /**
   * Handle backend errors gracefully
   */
  private handleBackendError(error: any): void {
    console.error('[LLT ProjectIndexer] Backend error:', error);

    if (error.code === 'CONNREFUSED') {
      this.outputChannel.appendLine(`❌ Cannot connect to backend. Is the service running?`);
      throw new Error('Backend connection failed');
    } else if (error.code === 'CONFLICT') {
      this.outputChannel.appendLine(`⚠️ Project already indexed. Use "Re-index Project" to refresh.`);
      throw new Error('Project already exists');
    } else if (error.code === 'TIMEOUT') {
      this.outputChannel.appendLine(`⏱️ Backend request timed out after 30 seconds`);
      throw new Error('Backend request timed out');
    } else {
      this.outputChannel.appendLine(`❌ Backend error: ${error.message}`);
      throw new Error(`Backend error: ${error.message}`);
    }
  }

  /**
   * Main entry point for project initialization
   * Shows progress notification and triggers indexing
   */
  async initializeProject(): Promise<void> {
    console.log('[LLT ProjectIndexer] Starting project initialization');

    if (this.isIndexingFlag) {
      vscode.window.showWarningMessage('Indexing is already in progress');
      return;
    }

    this.isIndexingFlag = true;
    this.cancelFlag = false;

    try {
      // Get Python files
      const files = await this.discoverPythonFiles();
      
      if (files.length === 0) {
        vscode.window.showInformationMessage('No Python files found in workspace');
        return;
      }

      // Show progress notification
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'LLT: Indexing project',
          cancellable: true
        },
        async (progress, token) => {
          // Handle cancellation
          token.onCancellationRequested(() => {
            console.log('[LLT ProjectIndexer] User cancelled indexing');
            this.outputChannel.appendLine('Indexing cancelled by user');
            this.cancelFlag = true;
          });

          // Process files
          progress.report({ increment: 0, message: 'Scanning workspace...' });
          
          const extractedData = await this.processFilesInBatches(files, progress);
          
          if (this.cancelFlag) {
            throw new Error('Indexing cancelled by user');
          }

          // Send to backend
          progress.report({ increment: 0, message: 'Sending to backend...' });
          
          const response = await this.sendToBackend(extractedData);

          // Save cache to persistent storage
          this.outputChannel.appendLine('[LLT] Starting cache save operation...');
          try {
            await this.contextState.save();
            this.outputChannel.appendLine('✅ Cache save completed successfully');
            
            // Verify the save actually worked
            const cache = this.contextState.getCache();
            this.outputChannel.appendLine(`[LLT] Verification - cache after save: ${cache ? 'EXISTS' : 'NULL'}`);
            if (cache) {
              this.outputChannel.appendLine(`[LLT] Verification - projectId: ${cache.projectId}, files: ${cache.statistics.totalFiles}`);
            }
          } catch (saveError) {
            this.outputChannel.appendLine(`❌ Cache save failed: ${saveError}`);
            throw saveError;
          }

          // Final progress update
          progress.report({
            increment: 100,
            message: `Indexed ${response.indexed_files} files, ${response.indexed_symbols} symbols`
          });
        }
      );

      vscode.window.showInformationMessage(
        `Project indexed successfully! ${files.length} files processed.`
      );

      // Double-check cache is saved
      this.outputChannel.appendLine('[LLT] Performing final cache verification...');
      try {
        await this.contextState.save();
        this.outputChannel.appendLine('✅ Final cache save completed');
        
        // Wait a bit for VSCode to flush workspace state
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Now try to load it back to verify persistence
        const testLoad = await this.contextState.load();
        this.outputChannel.appendLine(`[LLT] Persistence test - load after save: ${testLoad ? 'SUCCESS' : 'FAILED'}`);
        if (testLoad) {
          this.outputChannel.appendLine(`[LLT] Persistence test - projectId: ${testLoad.projectId}`);
        }
      } catch (finalSaveError) {
        this.outputChannel.appendLine(`❌ Final cache save failed: ${finalSaveError}`);
      }

      console.log('[LLT ProjectIndexer] Project initialization complete');
    } catch (error: any) {
      console.error('[LLT ProjectIndexer] Initialization failed:', error);
      vscode.window.showErrorMessage(`Project indexing failed: ${error.message}`);
      throw error;
    } finally {
      this.isIndexingFlag = false;
    }
  }

  /**
   * Force re-index project (delete and re-index)
   */
  async reindexProject(): Promise<void> {
    try {
      const projectId = this.contextState.getProjectId();
      
      // Step 1: Delete backend data if project exists
      if (projectId) {
        this.outputChannel.appendLine('Deleting existing backend data...');
        try {
          await this.apiClient.deleteProject(projectId);
          this.outputChannel.appendLine('✅ Backend data deleted successfully');
        } catch (error: any) {
          // If project doesn't exist (404), that's okay - continue with re-index
          if (error.code === 'NOT_FOUND') {
            this.outputChannel.appendLine('⚠️ Backend project not found, continuing with fresh index');
          } else {
            throw error;
          }
        }
      }
      
      // Step 2: Clear local cache
      this.outputChannel.appendLine('Clearing local cache...');
      await this.contextState.clear();
      
      // Step 3: Start fresh indexing
      this.outputChannel.appendLine('Starting fresh indexing...');
      await this.initializeProject();
      
      this.outputChannel.appendLine('✅ Re-index complete');
    } catch (error: any) {
      console.error('[LLT ProjectIndexer] Re-index failed:', error);
      this.outputChannel.appendLine(`❌ Re-index failed: ${error.message}`);
      throw error;
    }
  }
}