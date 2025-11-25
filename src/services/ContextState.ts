import * as vscode from 'vscode';
import { ApiClient } from './ApiClient';
import { MAX_CACHE_AGE_MS, CACHE_SCHEMA_VERSION } from '../config';

/**
 * Cached symbol information for a single file
 */
export interface SymbolInfo {
  name: string;
  kind: 'function' | 'class' | 'method';
  signature?: string;
  line_start: number;
  line_end: number;
  calls: string[];
  detail?: string;
}

/**
 * Serialized version stored in Memento
 */
interface SerializedCache {
  projectId: string;
  workspacePath: string;
  lastIndexedAt: string; // ISO timestamp
  version: number;
  backendVersion: number;
  fileSymbols: Record<string, SymbolInfo[]>;
  statistics: {
    totalFiles: number;
    totalSymbols: number;
  };
}

/**
 * Internal cache structure with full functionality
 */
interface ProjectCache {
  projectId: string;
  workspacePath: string;
  lastIndexedAt: Date;
  version: number; // Schema version for migrations
  backendVersion: number; // Backend's optimistic lock version
  fileSymbols: Map<string, SymbolInfo[]>; // filePath -> symbols
  statistics: {
    totalFiles: number;
    totalSymbols: number;
  };
}

// Configuration constants are now imported from config.ts

/**
 * Centralized state management for project context
 * Handles cache persistence, validation, and migrations
 */
export class ContextState {
  private readonly CACHE_KEY = 'llt.projectCache';
  private cache: ProjectCache | null = null;

  constructor(
    private context: vscode.ExtensionContext,
    private apiClient: ApiClient
  ) {}

  /**
   * Load cache from VSCode workspace state
   */
  async load(): Promise<ProjectCache | null> {
    try {
      console.log('[LLT ContextState] Attempting to load cache from workspace state...');
      const data = this.context.workspaceState.get<SerializedCache>(this.CACHE_KEY);
      
      if (!data) {
        console.log('[LLT ContextState] No cache found in workspace state (returns null)');
        return null;
      }

      console.log('[LLT ContextState] Raw cache data loaded:', JSON.stringify({
        hasProjectId: !!data.projectId,
        hasWorkspacePath: !!data.workspacePath,
        hasLastIndexedAt: !!data.lastIndexedAt,
        projectId: data.projectId,
        workspacePath: data.workspacePath,
        lastIndexedAt: data.lastIndexedAt,
        version: data.version,
        statistics: data.statistics
      }, null, 2));

      // Validate basic structure
      if (!data.projectId || !data.workspacePath || !data.lastIndexedAt) {
        console.warn('[LLT ContextState] Corrupted cache structure, resetting');
        await this.clear();
        return null;
      }

      // Deserialize from Object back to Map
      const fileSymbols = new Map<string, SymbolInfo[]>();
      if (data.fileSymbols) {
        for (const [path, symbols] of Object.entries(data.fileSymbols)) {
          fileSymbols.set(path, symbols);
        }
      }

      // Check schema version and migrate if needed
      const migrated = await this.migrateIfNeeded(data);
      
      this.cache = {
        projectId: migrated.projectId,
        workspacePath: migrated.workspacePath,
        lastIndexedAt: new Date(migrated.lastIndexedAt),
        version: migrated.version,
        backendVersion: migrated.backendVersion,
        fileSymbols,
        statistics: migrated.statistics || {
          totalFiles: 0,
          totalSymbols: 0
        }
      };

      console.log(`[LLT ContextState] Cache loaded: ${migrated.statistics.totalFiles} files, ${migrated.statistics.totalSymbols} symbols`);
      return this.cache;
    } catch (error) {
      console.error('[LLT ContextState] Error loading cache:', error);
      await this.clear();
      return null;
    }
  }

  /**
   * Save cache to VSCode workspace state
   */
  async save(): Promise<void> {
    if (!this.cache) {
      console.warn('[LLT ContextState] save() called but cache is null, skipping');
      return;
    }

    try {
      console.log('[LLT ContextState] Starting cache save operation...');
      console.log('[LLT ContextState] Current cache state:', JSON.stringify({
        projectId: this.cache.projectId,
        workspacePath: this.cache.workspacePath,
        lastIndexedAt: this.cache.lastIndexedAt.toISOString(),
        version: this.cache.version,
        backendVersion: this.cache.backendVersion,
        totalFiles: this.cache.statistics.totalFiles,
        totalSymbols: this.cache.statistics.totalSymbols,
        fileCount: this.cache.fileSymbols.size
      }, null, 2));

      // Serialize Map to Object
      const fileSymbols: Record<string, SymbolInfo[]> = {};
      for (const [path, symbols] of this.cache.fileSymbols.entries()) {
        fileSymbols[path] = symbols;
      }

      const data: SerializedCache = {
        projectId: this.cache.projectId,
        workspacePath: this.cache.workspacePath,
        lastIndexedAt: this.cache.lastIndexedAt.toISOString(),
        version: this.cache.version,
        backendVersion: this.cache.backendVersion,
        fileSymbols,
        statistics: this.cache.statistics
      };

      console.log('[LLT ContextState] Serialized cache data:', JSON.stringify({
        hasProjectId: !!data.projectId,
        hasWorkspacePath: !!data.workspacePath,
        hasLastIndexedAt: !!data.lastIndexedAt,
        version: data.version,
        totalFiles: data.statistics.totalFiles,
        totalSymbols: data.statistics.totalSymbols,
        keys: Object.keys(data)
      }, null, 2));

      await this.context.workspaceState.update(this.CACHE_KEY, data);
      console.log('[LLT ContextState] ✅ Cache successfully saved to workspace state');
      
      // Verify it was actually saved
      const verifyData = this.context.workspaceState.get(this.CACHE_KEY);
      console.log('[LLT ContextState] Verification - data retrieved after save:', !!verifyData);
    } catch (error) {
      console.error('[LLT ContextState] ❌ Error saving cache:', error);
      throw error;
    }
  }

  /**
   * Check if cache is valid and can be used. Now includes a check against the backend.
   */
  async isValid(): Promise<boolean> {
    if (!this.cache) {
      console.log('[LLT ContextState] Cache invalid: empty cache');
      return false;
    }

    // Check 1: Schema version
    if (this.cache.version !== CACHE_SCHEMA_VERSION) {
      console.log('[LLT ContextState] Cache invalid: schema version mismatch');
      return false;
    }

    // Check 2: Workspace path
    const currentWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!currentWorkspacePath || this.cache.workspacePath !== currentWorkspacePath) {
      console.log('[LLT ContextState] Cache invalid: workspace path changed');
      return false;
    }

    // Check 3: Age
    const age = Date.now() - this.cache.lastIndexedAt.getTime();
    if (age > MAX_CACHE_AGE_MS) {
      console.log(`[LLT ContextState] Cache invalid: too old (${Math.round(age / (1000 * 3600 * 24))} days)`);
      return false;
    }

    // Check 4: Backend project existence (optional, network request)
    try {
      const backendStatus = await this.apiClient.getProjectStatus(this.cache.projectId);
      if (backendStatus.status === 'not_found') {
        console.log('[LLT ContextState] Cache invalid: backend project not found');
        return false;
      }
    } catch (error) {
      // If backend is down, we can't validate. Treat as temporarily valid to allow offline work.
      console.warn('[LLT ContextState] Could not verify project with backend, assuming valid for now.', error);
    }

    console.log('[LLT ContextState] Cache is valid');
    return true;
  }

  /**
   * Get all symbols for a specific file
   */
  getSymbols(filePath: string): SymbolInfo[] | undefined {
    return this.cache?.fileSymbols.get(filePath);
  }

  /**
   * Set symbols for a specific file and update statistics
   */
  setSymbols(filePath: string, symbols: SymbolInfo[]): void {
    if (!this.cache) {
      throw new Error('Cache not initialized');
    }

    // Remove old stats if updating existing file
    const oldSymbols = this.cache.fileSymbols.get(filePath);
    if (oldSymbols) {
      this.cache.statistics.totalSymbols -= oldSymbols.length;
    } else {
      // This is a new file
      this.cache.statistics.totalFiles += 1;
    }

    // Set new symbols
    this.cache.fileSymbols.set(filePath, symbols);
    this.cache.statistics.totalSymbols += symbols.length;
  }

  /**
   * Remove a file and update statistics
   */
  removeFile(filePath: string): void {
    if (!this.cache) {
      return;
    }

    const symbols = this.cache.fileSymbols.get(filePath);
    if (symbols) {
      this.cache.fileSymbols.delete(filePath);
      this.cache.statistics.totalFiles -= 1;
      this.cache.statistics.totalSymbols -= symbols.length;
    }
  }

  /**
   * Check if project has been indexed
   */
  isIndexed(): boolean {
    return this.cache !== null && this.cache.statistics.totalFiles > 0;
  }

  /**
   * Get current cache version
   */
  getVersion(): number {
    if (!this.cache) {
      throw new Error('Cache not initialized');
    }
    return this.cache.backendVersion;
  }

  /**
   * Set backend version (for optimistic locking)
   */
  setVersion(version: number): void {
    if (!this.cache) {
      throw new Error('Cache not initialized');
    }
    this.cache.backendVersion = version;
  }

  /**
   * Get project ID
   */
  getProjectId(): string | undefined {
    return this.cache?.projectId;
  }

  /**
   * Set project ID and initialize cache if it doesn't exist.
   */
  setProjectId(projectId: string): void {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    
    if (!this.cache) {
      this.cache = {
        projectId,
        workspacePath,
        lastIndexedAt: new Date(),
        version: CACHE_SCHEMA_VERSION,
        backendVersion: 0,
        fileSymbols: new Map(),
        statistics: { totalFiles: 0, totalSymbols: 0 }
      };
    } else {
      this.cache.projectId = projectId;
      this.cache.workspacePath = workspacePath;
    }
    this.updateLastIndexedAt();
  }

  /**
   * Get the entire cache
   */
  getCache(): ProjectCache | null {
    return this.cache;
  }

  /**
   * Clear all cached data
   */
  async clear(): Promise<void> {
    console.log('[LLT ContextState] Clearing cache');
    this.cache = null;
    await this.context.workspaceState.update(this.CACHE_KEY, undefined);
  }

  /**
   * Clear only symbol data while preserving project metadata
   * Used for graceful recovery from version conflicts
   */
  clearSymbolsOnly(): void {
    if (!this.cache) {
      console.warn('[LLT ContextState] Cannot clear symbols: cache not initialized');
      return;
    }
    
    console.log('[LLT ContextState] Clearing only symbol data');
    this.cache.fileSymbols.clear();
    this.cache.statistics.totalFiles = 0;
    this.cache.statistics.totalSymbols = 0;
  }

  /**
   * Update last indexed timestamp
   */
  updateLastIndexedAt(): void {
    if (this.cache) {
      this.cache.lastIndexedAt = new Date();
    }
  }

  /**
   * Migrate old cache versions to current version
   */
  private async migrateIfNeeded(data: any): Promise<SerializedCache> {
    if (data.version === CACHE_SCHEMA_VERSION) {
      return data;
    }

    console.log(`[LLT ContextState] Migrating cache from v${data.version} to v${CACHE_SCHEMA_VERSION}`);
    // In a real scenario, you'd have migration logic here.
    // For now, we just update the version.
    const migrated = {
      ...data,
      version: CACHE_SCHEMA_VERSION,
      backendVersion: data.backendVersion || 0,
      fileSymbols: data.fileSymbols || {},
      statistics: data.statistics || { totalFiles: 0, totalSymbols: 0 }
    } as SerializedCache;

    // Save migrated cache immediately to avoid re-migration
    await this.context.workspaceState.update(this.CACHE_KEY, migrated);
    console.log('[LLT ContextState] Migration complete');
    
    return migrated;
  }

  /**
   * Recalculate statistics from file symbols map
   */
  recalculateStatistics(): void {
    if (!this.cache) {
      return;
    }

    this.cache.statistics.totalFiles = this.cache.fileSymbols.size;
    this.cache.statistics.totalSymbols = Array.from(this.cache.fileSymbols.values())
      .reduce((acc, symbols) => acc + symbols.length, 0);

    console.log(`[LLT ContextState] Statistics recalculated: ${this.cache.statistics.totalFiles} files, ${this.cache.statistics.totalSymbols} symbols`);
  }
}