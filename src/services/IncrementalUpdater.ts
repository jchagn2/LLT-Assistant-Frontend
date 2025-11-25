import * as vscode from 'vscode';
import { ContextState, SymbolInfo } from './ContextState';
import { ApiClient, IncrementalUpdateResponse, apiClient } from './ApiClient';
import { FILE_CHANGE_DEBOUNCE_MS, STATUS_SUCCESS_HIDE_DELAY_MS, STATUS_ERROR_HIDE_DELAY_MS } from '../config';

/**
 * Describes a symbol change between old and new state (internal use)
 */
export interface SymbolChange {
  action: 'added' | 'modified' | 'deleted';
  name: string;
  oldData?: SymbolInfo;
  newData?: SymbolInfo;
}

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
    symbols_changed?: SymbolChange[];
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
    const filePath = document.uri.fsPath;
    const projectId = this.contextState.getProjectId();

    if (!projectId) {
      console.warn('[LLT IncrementalUpdater] Project not initialized, skipping update');
      return;
    }

    // Show syncing indicator
    this.statusBarItem.text = '$(sync~spin) Syncing...';
    this.statusBarItem.show();

    try {
      console.log(`[LLT IncrementalUpdater] Processing update for ${filePath}`);
      this.outputChannel.appendLine(`Processing update: ${filePath}`);

      // Extract current symbols
      const { extractSymbolsFromDocument } = await import('../utils/symbolExtraction.js');
      const newSymbols = await extractSymbolsFromDocument(document);

      // Get old symbols from cache
      const oldSymbols = this.contextState.getSymbols(filePath) || [];

      // Calculate diff
      const changes = this.calculateDiff(oldSymbols, newSymbols);

      if (changes.length === 0) {
        console.log(`[LLT IncrementalUpdater] No changes detected for ${filePath}`);
        this.showSuccessStatus();
        return;
      }

      console.log(`[LLT IncrementalUpdater] Detected ${changes.length} changes`);
      this.outputChannel.appendLine(`Detected ${changes.length} changes`);

      // Send to backend
      await this.sendToBackend(projectId, filePath, changes);

      // Update cache
      if (changes.some(c => c.action === 'deleted' && !newSymbols.some((s: SymbolInfo) => s.name === c.name))) {
        // Check if all symbols were deleted
        if (newSymbols.length === 0) {
          this.contextState.removeFile(filePath);
        }
      } else {
        this.contextState.setSymbols(filePath, newSymbols);
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
  private async processFileDeletion(filePath: string): Promise<void> {
    const projectId = this.contextState.getProjectId();
    
    if (!projectId) {
      return;
    }

    const oldSymbols = this.contextState.getSymbols(filePath);
    
    if (!oldSymbols || oldSymbols.length === 0) {
      return; // File wasn't indexed, nothing to do
    }

    const changes: SymbolChange[] = oldSymbols.map(symbol => ({
      action: 'deleted' as const,
      name: symbol.name,
      oldData: symbol
    }));

    // Show syncing indicator
    this.statusBarItem.text = '$(sync~spin) Syncing...';
    this.statusBarItem.show();

    try {
      // Send deletion to backend
      await this.sendToBackend(projectId, filePath, changes);

      // Remove from cache
      this.contextState.removeFile(filePath);
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
  ): SymbolChange[] {
    const changes: SymbolChange[] = [];

    // Create lookup maps for O(1) access
    const oldMap = new Map(oldSymbols.map(s => [s.name, s]));
    const newMap = new Map(newSymbols.map(s => [s.name, s]));

    // Find added and modified symbols
    for (const [name, newSym] of newMap.entries()) {
      const oldSym = oldMap.get(name);

      if (!oldSym) {
        // New symbol added
        changes.push({
          action: 'added',
          name,
          newData: newSym
        });
      } else if (this.hasChanged(oldSym, newSym)) {
        // Symbol modified
        changes.push({
          action: 'modified',
          name,
          oldData: oldSym,
          newData: newSym
        });
      }
    }

    // Find deleted symbols
    for (const [name, oldSym] of oldMap.entries()) {
      if (!newMap.has(name)) {
        // Symbol deleted
        changes.push({
          action: 'deleted',
          name,
          oldData: oldSym
        });
      }
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
    changes: SymbolChange[]
  ): Promise<void> {
    const payload: IncrementalUpdateRequest = {
      version: this.contextState.getVersion(),
      changes: [{
        file_path: filePath,
        action: 'modified',
        symbols_changed: changes
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
      this.outputChannel.appendLine(`⚠️ Version conflict detected. Cache is out of sync.`);
      vscode.window.showWarningMessage(
        'Project cache is out of sync. Re-index recommended.',
        'Re-index Now'
      ).then(action => {
        if (action === 'Re-index Now') {
          vscode.commands.executeCommand('llt.reindexProject');
        }
      });
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
