import * as vscode from 'vscode';
import { ContextState, SymbolInfo } from './ContextState';
import { ApiClient, IncrementalUpdateResponse, apiClient } from './ApiClient';
import { FILE_CHANGE_DEBOUNCE_MS, STATUS_SUCCESS_HIDE_DELAY_MS, STATUS_ERROR_HIDE_DELAY_MS } from '../config';

/**
 * Diff calculation result - internal use for separation of concerns
 */
export interface SymbolDiff {
  added: SymbolInfo[];
  modified: SymbolInfo[];
  deleted: SymbolInfo[];
}

/**
 * Backend-expected symbol change format
 */
export interface BackendSymbolChange {
  action: 'added' | 'modified' | 'deleted';
  symbol: SymbolInfo;
}

/**
 * Payload for incremental updates
 */
export interface IncrementalUpdateRequest {
  version: number;
  changes: Array<{
    file_path: string;
    action: 'modified' | 'deleted';
    symbols_changed?: BackendSymbolChange[];
  }>;
}

/**
 * Monitors file changes and sends incremental updates to backend
 */
export class IncrementalUpdater implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private updateTimers = new Map<string, NodeJS.Timeout>();
  private readonly DEBOUNCE_MS = FILE_CHANGE_DEBOUNCE_MS;
  private statusBarItem: vscode.StatusBarItem;
  private apiClient: ApiClient;
  private outputChannel: vscode.OutputChannel;
  private isOutOfSync = false; // Track if version conflict occurred

  constructor(
    private contextState: ContextState,
    outputChannel: vscode.OutputChannel
  ) {
    this.apiClient = apiClient;
    this.outputChannel = outputChannel;
    
    // Create status bar item for sync feedback
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.text = '$(sync) LLT Sync';
    this.disposables.push(this.statusBarItem);
  }

  /**
   * Start monitoring file system events
   */
  startMonitoring(): void {
    console.log('[LLT IncrementalUpdater] Starting file monitoring');
    this.outputChannel.appendLine('File monitoring started');

    // Register event listeners
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(this.onFileSaved, this)
    );

    this.disposables.push(
      vscode.workspace.onDidDeleteFiles(this.onFilesDeleted, this)
    );

    this.disposables.push(
      vscode.workspace.onDidCreateFiles(this.onFilesCreated, this)
    );
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    console.log('[LLT IncrementalUpdater] Disposing file monitoring');
    this.outputChannel.appendLine('File monitoring stopped');

    // Clear all pending timers
    for (const timer of this.updateTimers.values()) {
      clearTimeout(timer);
    }
    this.updateTimers.clear();

    // Dispose event listeners
    this.disposables.forEach(d => d.dispose());
  }

  /**
   * Handle file save event
   */
  private onFileSaved(document: vscode.TextDocument): void {
    // Filter: Only Python files
    if (document.languageId !== 'python') {
      return;
    }

    // Filter: Only files in workspace
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return;
    }

    // Filter: Skip temporary files
    const filePath = document.uri.fsPath;
    if (filePath.includes('__pycache__') || 
        filePath.includes('node_modules') || 
        filePath.includes('.venv') ||
        filePath.includes('venv')) {
      return;
    }

    console.log(`[LLT IncrementalUpdater] File saved: ${filePath}`);
    this.scheduleUpdate(document);
  }

  /**
   * Handle file delete event
   */
  private async onFilesDeleted(event: vscode.FileDeleteEvent): Promise<void> {
    for (const file of event.files) {
      // Only process Python files
      if (!file.fsPath.endsWith('.py')) {
        continue;
      }

      // Only files in workspace
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(file);
      if (!workspaceFolder) {
        continue;
      }

      const filePath = file.fsPath;
      console.log(`[LLT IncrementalUpdater] File deleted: ${filePath}`);
      
      try {
        await this.processFileDeletion(filePath);
      } catch (error) {
        console.error(`[LLT IncrementalUpdater] Error processing deletion:`, error);
      }
    }
  }

  /**
   * Handle file create event
   */
  private async onFilesCreated(event: vscode.FileCreateEvent): Promise<void> {
    for (const file of event.files) {
      // Only process Python files
      if (!file.fsPath.endsWith('.py')) {
        continue;
      }

      // Only files in workspace
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(file);
      if (!workspaceFolder) {
        continue;
      }

      const filePath = file.fsPath;
      console.log(`[LLT IncrementalUpdater] File created: ${filePath}`);
      
      try {
        // Open document and schedule update
        const document = await vscode.workspace.openTextDocument(file);
        this.scheduleUpdate(document);
      } catch (error) {
        console.error(`[LLT IncrementalUpdater] Error processing creation:`, error);
      }
    }
  }

  /**
   * Schedule an update with debouncing
   */
  private scheduleUpdate(document: vscode.TextDocument): void {
    const filePath = document.uri.fsPath;
    
    // Clear existing timer for this file
    const existingTimer = this.updateTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new update
    const timer = setTimeout(async () => {
      try {
        await this.processUpdate(document);
      } catch (error) {
        console.error(`[LLT IncrementalUpdater] Error processing update:`, error);
      } finally {
        this.updateTimers.delete(filePath);
      }
    }, this.DEBOUNCE_MS);

    this.updateTimers.set(filePath, timer);
    
    // Show pending status
    this.statusBarItem.text = '$(clock) Pending sync...';
    this.statusBarItem.show();
  }

  /**
   * Process file update
   */
  private async processUpdate(document: vscode.TextDocument): Promise<void> {
    // If we're out of sync, block all updates until re-index
    if (this.isOutOfSync) {
      console.warn('[LLT IncrementalUpdater] Out of sync - blocking update. Re-index required.');
      this.outputChannel.appendLine(`Blocked: ${vscode.workspace.asRelativePath(document.uri)} - cache is out of sync`);
      return;
    }

    const absolutePath = document.uri.fsPath;
    const relativePath = vscode.workspace.asRelativePath(document.uri);
    const projectId = this.contextState.getProjectId();
    
    console.log(`[LLT] Path validation - absolute: ${absolutePath}, relative: ${relativePath}`);

    if (!projectId) {
      console.warn('[LLT IncrementalUpdater] Project not initialized, skipping update');
      return;
    }

    // Show syncing indicator
    this.statusBarItem.text = '$(sync~spin) Syncing...';
    this.statusBarItem.show();

    try {
      console.log(`[LLT IncrementalUpdater] Processing update for ${relativePath}`);
      this.outputChannel.appendLine(`Processing update: ${relativePath}`);

      // Extract current symbols
      const { extractSymbolsFromDocument } = await import('../utils/symbolExtraction.js');
      const newSymbols = await extractSymbolsFromDocument(document);

      // Get old symbols from cache
      const oldSymbols = this.contextState.getSymbols(absolutePath) || [];

      // Calculate diff
      const diff = this.calculateDiff(oldSymbols, newSymbols);

      // Convert to backend format
      const backendChanges = this.formatDiffForBackend(diff);

      if (backendChanges.length === 0) {
        console.log(`[LLT IncrementalUpdater] No changes detected for ${relativePath}`);
        this.showSuccessStatus();
        return;
      }

      console.log(`[LLT IncrementalUpdater] Detected ${backendChanges.length} changes`);
      this.outputChannel.appendLine(`Detected ${backendChanges.length} changes`);

      // Send to backend (use relative path)
      try {
        await this.sendToBackend(projectId, relativePath, 'modified', backendChanges);
      } catch (error: any) {
        // Handle version conflict with automatic recovery
        if (error.code === 'CONFLICT') {
          console.log('[LLT IncrementalUpdater] Version conflict detected, attempting automatic recovery...');
          this.outputChannel.appendLine(`⚠️ Version conflict detected for ${relativePath}. Attempting automatic recovery...`);
          
          try {
            // Step 1: Get latest project data from backend
            this.outputChannel.appendLine('  → Fetching latest project data from backend...');
            const projectData = await this.apiClient.getProjectData(projectId);
            
            // Step 2: Update local cache with backend data
            this.outputChannel.appendLine(`  → Updating local cache with ${projectData.files.length} files, version ${projectData.version}...`);
            
            // Clear only symbol data, preserve project metadata
            this.contextState.clearSymbolsOnly();
            
            // Repopulate cache with backend data
            for (const file of projectData.files) {
              // Find matching document or use file path directly
              const fileUri = vscode.Uri.file(`${projectData.workspace_path}/${file.path}`);
              
              // Transform symbols to match SymbolInfo interface (type casting for kinds)
              const transformedSymbols = file.symbols.map(sym => ({
                ...sym,
                kind: sym.kind as SymbolInfo['kind'] // Cast string to literal type
              }));
              
              this.contextState.setSymbols(fileUri.fsPath, transformedSymbols);
            }
            
            // Update version
            this.contextState.setVersion(projectData.version);
            await this.contextState.save();
            
            this.outputChannel.appendLine('  ✅ Cache synchronized with backend');
            
            // Step 3: Retry the incremental update with new version
            this.outputChannel.appendLine(`  → Retrying update with version ${projectData.version}...`);
            
            // Re-extract symbols (in case they changed during sync)
            const retrySymbols = await extractSymbolsFromDocument(document);
            const retryDiff = this.calculateDiff(this.contextState.getSymbols(absolutePath) || [], retrySymbols);
            const retryBackendChanges = this.formatDiffForBackend(retryDiff);
            
            if (retryBackendChanges.length > 0) {
              await this.sendToBackend(projectId, relativePath, 'modified', retryBackendChanges);
              
              // Update cache with new symbols
              this.contextState.setSymbols(absolutePath, retrySymbols);
              await this.contextState.save();
              
              this.outputChannel.appendLine(`  ✅ Automatic recovery successful! Update applied with ${retryBackendChanges.length} changes.`);
            } else {
              this.outputChannel.appendLine('  ℹ️ No changes to apply after recovery.');
            }
            
            this.showSuccessStatus();
            return; // Successfully recovered, skip error handling
            
          } catch (recoveryError: any) {
            console.error('[LLT IncrementalUpdater] Automatic recovery failed:', recoveryError);
            this.outputChannel.appendLine(`  ❌ Automatic recovery failed: ${recoveryError.message}`);
            
            // Fall back to manual re-index if automatic recovery fails
            this.outputChannel.appendLine('  → Falling back to manual re-index...');
            this.isOutOfSync = true;
            
            vscode.window.showErrorMessage(
              'LLT Assistant: Failed to automatically recover from version conflict. Manual re-index required.',
              { modal: true },
              'Re-index Now'
            ).then(action => {
              if (action === 'Re-index Now') {
                vscode.commands.executeCommand('llt.reindexProject');
                this.isOutOfSync = false;
              }
            });
            
            throw error; // Re-throw original error
          }
        } else {
          // Non-recoverable error, let handleBackendError handle it
          throw error;
        }
      }

      // Update cache (use absolute path to maintain consistency with cache keys)
      if (newSymbols.length === 0) {
        this.contextState.removeFile(absolutePath);
      } else {
        this.contextState.setSymbols(absolutePath, newSymbols);
      }

      await this.contextState.save();

      // Show success
      this.showSuccessStatus();

    } catch (error: any) {
      this.showErrorStatus(error);
      throw error;
    }
  }

  /**
   * Process file deletion
   */
  private async processFileDeletion(absolutePath: string): Promise<void> {
    const projectId = this.contextState.getProjectId();

    if (!projectId) {
      return;
    }

    // Convert to relative path for consistency
    const relativePath = vscode.workspace.asRelativePath(vscode.Uri.file(absolutePath));
    const oldSymbols = this.contextState.getSymbols(absolutePath);

    if (!oldSymbols || oldSymbols.length === 0) {
      return; // File wasn't indexed, nothing to do
    }

    // Construct diff: all symbols are deleted
    const diff: SymbolDiff = {
      added: [],
      modified: [],
      deleted: oldSymbols
    };

    // Convert to backend format
    const backendChanges = this.formatDiffForBackend(diff);

    // Show syncing indicator
    this.statusBarItem.text = '$(sync~spin) Syncing...';
    this.statusBarItem.show();

    try {
      // Send deletion to backend
      await this.sendToBackend(projectId, relativePath, 'deleted');

      // Remove from cache
      this.contextState.removeFile(absolutePath);  // Cache still uses absolute path internally
      await this.contextState.save();

      this.showSuccessStatus();

    } catch (error) {
      this.showErrorStatus(error);
      throw error;
    }
  }

  /**
   * Calculate diff between old and new symbols
   */
  private calculateDiff(
    oldSymbols: SymbolInfo[],
    newSymbols: SymbolInfo[]
  ): SymbolDiff {
    const added: SymbolInfo[] = [];
    const modified: SymbolInfo[] = [];
    const deleted: SymbolInfo[] = [];

    // Create lookup maps for O(1) access
    const oldMap = new Map(oldSymbols.map(s => [s.name, s]));
    const newMap = new Map(newSymbols.map(s => [s.name, s]));

    // Find added and modified symbols
    for (const [name, newSym] of newMap.entries()) {
      const oldSym = oldMap.get(name);

      if (!oldSym) {
        // New symbol added
        added.push(newSym);
      } else if (this.hasChanged(oldSym, newSym)) {
        // Symbol modified - store new version
        modified.push(newSym);
      }
    }

    // Find deleted symbols
    for (const [name, oldSym] of oldMap.entries()) {
      if (!newMap.has(name)) {
        // Symbol deleted - store old version
        deleted.push(oldSym);
      }
    }

    return { added, modified, deleted };
  }

  /**
   * Convert internal SymbolDiff to backend-expected format
   */
  private formatDiffForBackend(diff: SymbolDiff): BackendSymbolChange[] {
    const changes: BackendSymbolChange[] = [];

    for (const symbol of diff.added) {
      changes.push({ action: 'added', symbol });
    }

    for (const symbol of diff.modified) {
      changes.push({ action: 'modified', symbol });
    }

    for (const symbol of diff.deleted) {
      changes.push({ action: 'deleted', symbol });
    }

    return changes;
  }

  /**
   * Check if symbol has changed
   */
  private hasChanged(old: SymbolInfo, newSymbol: SymbolInfo): boolean {
    // Compare relevant fields (skip line numbers as they can shift due to unrelated changes)
    if (old.signature !== newSymbol.signature) {
      return true;
    }
    if (old.kind !== newSymbol.kind) {
      return true;
    }
    if (!this.arraysEqual(old.calls, newSymbol.calls)) {
      return true;
    }
    return false;
  }

  /**
   * Check if two arrays are equal
   */
  private arraysEqual<T>(a: T[], b: T[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => item === b[index]);
  }

  /**
   * Send changes to backend
   */
  private async sendToBackend(
    projectId: string,
    filePath: string,
    action: 'modified' | 'deleted',
    changes?: BackendSymbolChange[]
  ): Promise<void> {
    const payload: IncrementalUpdateRequest = {
      version: this.contextState.getVersion(),
      changes: [{
        file_path: filePath,
        action: action,
        symbols_changed: action === 'modified' ? changes : undefined
      }]
    };

    try {
      const response = await this.apiClient.sendIncrementalUpdate(projectId, payload);
      
      // Update local version for optimistic locking
      this.contextState.setVersion(response.version);
      this.outputChannel.appendLine(`Backend update complete: ${response.changes_applied} changes applied (${response.processing_time_ms}ms)`);

    } catch (error: any) {
      this.handleBackendError(error, filePath);
      throw error;
    }
  }

  /**
   * Handle backend errors
   */
  private handleBackendError(error: any, filePath: string): void {
    console.error('[LLT IncrementalUpdater] Backend error:', error);

    if (error.code === 'CONNREFUSED') {
      this.outputChannel.appendLine(`❌ Cannot connect to backend. Update for ${filePath} will be applied on next save.`);
      // Don't show modal dialog (too intrusive), just log
    } else if (error.code === 'NOT_FOUND') {
      this.outputChannel.appendLine(`⚠️ Project not found. Triggering full re-index...`);
      // Project not initialized - trigger full index
      vscode.commands.executeCommand('llt.reindexProject');
    } else if (error.code === 'CONFLICT') {
      // This should have been handled in processUpdate with automatic recovery
      // Keeping this as a fallback in case something goes wrong
      this.outputChannel.appendLine(`⚠️ Version conflict detected. Automatic recovery was attempted but failed.`);
      this.isOutOfSync = true; // Set flag to block future updates
      
      // Don't show dialog here - the automatic recovery process in processUpdate should handle it
      // If we reach here, it means automatic recovery already failed and showed a dialog
    } else {
      this.outputChannel.appendLine(`❌ Update failed: ${error.message}`);
    }
  }

  /**
   * Show success status in status bar
   */
  private showSuccessStatus(): void {
    this.statusBarItem.text = '$(check) Synced';
    this.statusBarItem.tooltip = 'Project context synced';
    
    // Hide after configured delay
    setTimeout(() => {
      this.statusBarItem.hide();
    }, STATUS_SUCCESS_HIDE_DELAY_MS);
  }

  /**
   * Show error status in status bar
   */
  private showErrorStatus(error: any): void {
    this.statusBarItem.text = '$(error) Sync failed';
    this.statusBarItem.tooltip = `Sync failed: ${error.message}`;
    
    // Hide after configured delay
    setTimeout(() => {
      this.statusBarItem.hide();
    }, STATUS_ERROR_HIDE_DELAY_MS);
  }
}
