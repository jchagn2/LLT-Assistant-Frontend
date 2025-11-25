import * as vscode from 'vscode';

/**
 * API response interfaces
 */
export interface InitResponse {
  project_id: string;
  status: string;
  indexed_files: number;
  indexed_symbols: number;
  processing_time_ms: number;
}

export interface IncrementalUpdateResponse {
  project_id: string;
  version: number;
  updated_at: string;
  changes_applied: number;
  processing_time_ms: number;
}

/**
 * Base error class for API errors
 */
export class ApiError extends Error {
  code: string;
  status?: number;
  details?: string;

  constructor(code: string, message: string, status?: number, details?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }
}

/**
 * HTTP error (4xx, 5xx responses)
 */
export class HttpError extends ApiError {
  constructor(status: number, message: string, details?: string) {
    const code = `HTTP_${status}`;
    super(code, message, status, details);
    this.name = 'HttpError';
  }
}

/**
 * Connection error (backend unreachable)
 */
export class ConnectionError extends ApiError {
  constructor(baseUrl: string) {
    super(
      'CONNREFUSED',
      `Cannot connect to backend. Is the service running on ${baseUrl}?`,
      undefined,
      undefined
    );
    this.name = 'ConnectionError';
  }
}

/**
 * Timeout error (request took too long)
 */
export class TimeoutError extends ApiError {
  constructor(timeoutMs: number) {
    super(
      'TIMEOUT',
      `Request timed out after ${timeoutMs / 1000} seconds`,
      undefined,
      undefined
    );
    this.name = 'TimeoutError';
  }
}

/**
 * Backend API client with error handling and retries
 * Uses VSCode configuration for base URL
 */
export class ApiClient {
  private timeout: number;

  constructor(private readonly baseUrl?: string) {
    // Use provided baseUrl OR load from VSCode settings
    this.timeout = 30000; // 30 seconds
  }

  /**
   * Get the configured base URL
   */
  private getBaseUrl(): string {
    // 1. Use explicitly provided URL (for testing)
    if (this.baseUrl) {
      return this.baseUrl;
    }
    
    // 2. Load from VSCode settings
    try {
      const config = vscode.workspace.getConfiguration('llt-assistant');
      // Use quality backend URL for context system (port 8886)
      const url = config.get<string>('quality.backendUrl') || config.get<string>('backendUrl');
      if (url && url.trim()) {
        return url;
      }
    } catch (error) {
      console.warn('[ApiClient] Could not load config:', error);
    }
    
    // 3. Fallback to default
    return 'https://cs5351.efan.dev';
  }

  /**
   * Initialize a project with batch symbol data
   */
  async initializeProject(payload: any): Promise<InitResponse> {
    console.log('[LLT API] POST /context/projects/initialize');
    
    try {
      const response = await this.post('/context/projects/initialize', payload);
      return response as InitResponse;
    } catch (error: any) {
      // Normalize errors
      throw this.normalizeError(error);
    }
  }

  /**
   * Send incremental updates
   */
  async sendIncrementalUpdate(projectId: string, payload: any): Promise<IncrementalUpdateResponse> {
    console.log(`[LLT API] PATCH /context/projects/${projectId}/incremental`);
    
    try {
      const response = await this.patch(`/context/projects/${projectId}/incremental`, payload);
      return response as IncrementalUpdateResponse;
    } catch (error: any) {
      throw this.normalizeError(error);
    }
  }

  /**
   * Delete project (for force re-index)
   */
  async deleteProject(projectId: string): Promise<void> {
    console.log(`[LLT API] DELETE /context/projects/${projectId}`);
    
    try {
      await this.delete(`/context/projects/${projectId}`);
    } catch (error: any) {
      throw this.normalizeError(error);
    }
  }

  /**
   * Check backend health
   */
  async healthCheck(): Promise<boolean> {
    console.log('[LLT API] GET /health');
    
    try {
      const response = await this.get('/health');
      // Handle both "ok" and "healthy" responses
      console.log(`[LLT API] Health check response: ${JSON.stringify(response)}`);
      const isHealthy = response.status === 'ok' || response.status === 'healthy';
      console.log(`[LLT API] Health check result: ${isHealthy}`);
      return isHealthy;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get full project status from the backend including version and data
   */
  async getProjectStatus(projectId: string): Promise<{
    status: 'ok' | 'not_found';
    project_id?: string;
    version?: number;
    indexed_files?: number;
    indexed_symbols?: number;
    last_updated_at?: string;
  }> {
    console.log(`[LLT API] GET /context/projects/${projectId}/status`);
    try {
      const response = await this.get(`/context/projects/${projectId}/status`);
      return {
        status: 'ok',
        project_id: response.project_id,
        version: response.backend_version || response.version,
        indexed_files: response.indexed_files,
        indexed_symbols: response.indexed_symbols,
        last_updated_at: response.last_updated_at
      };
    } catch (error: any) {
      if (error instanceof HttpError && error.status === 404) {
        return { status: 'not_found' };
      }
      throw this.normalizeError(error);
    }
  }

  /**
   * Get full project data including all files and symbols
   * Used for graceful recovery from version conflicts
   */
  async getProjectData(projectId: string): Promise<{
    project_id: string;
    version: number;
    workspace_path?: string;
    files: Array<{
      path: string;
      symbols: Array<{
        name: string;
        kind: string;
        signature: string;
        line_start: number;
        line_end: number;
        calls: string[];
      }>;
    }>;
  }> {
    console.log(`[LLT API] GET /context/projects/${projectId}`);
    
    try {
      const response = await this.get(`/context/projects/${projectId}`);
      return {
        project_id: response.project_id,
        version: response.version,
        workspace_path: response.workspace_path,
        files: response.files || []
      };
    } catch (error: any) {
      throw this.normalizeError(error);
    }
  }

  /**
   * POST request with timeout
   */
  private async post(endpoint: string, data: any): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.getBaseUrl()}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new HttpError(response.status, `Backend error: ${response.status} ${response.statusText}`, errorBody);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new TimeoutError(this.timeout);
      }
      
      if (error.code === 'ECONNREFUSED' || (typeof error.message === 'string' && error.message.includes('Failed to fetch'))) {
        throw new ConnectionError(this.getBaseUrl());
      }
      
      throw error;
    }
  }

  /**
   * PATCH request with timeout
   */
  private async patch(endpoint: string, data: any): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.getBaseUrl()}${endpoint}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new HttpError(response.status, `Backend error: ${response.status} ${response.statusText}`, errorBody);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new TimeoutError(this.timeout);
      }
      
      if (error.code === 'ECONNREFUSED' || (typeof error.message === 'string' && error.message.includes('Failed to fetch'))) {
        throw new ConnectionError(this.getBaseUrl());
      }
      
      throw error;
    }
  }

  /**
   * GET request
   */
  private async get(endpoint: string): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // Shorter timeout for health check

    try {
      const response = await fetch(`${this.getBaseUrl()}${endpoint}`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * DELETE request
   */
  private async delete(endpoint: string): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.getBaseUrl()}${endpoint}`, {
        method: 'DELETE',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new HttpError(response.status, `Backend error: ${response.status} ${response.statusText}`, errorBody);
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Normalize errors for consistent error handling
   */
  private normalizeError(error: any): any {
    if (error.code === 'HTTP_409') {
      return {
        code: 'CONFLICT',
        status: 409,
        message: 'Conflict: Project already exists'
      };
    }

    if (error.code === 'HTTP_404') {
      return {
        code: 'NOT_FOUND',
        status: 404,
        message: 'Project not found'
      };
    }

    if (error.code === 'HTTP_503') {
      return {
        code: 'UNAVAILABLE',
        status: 503,
        message: 'Backend service unavailable'
      };
    }

    return error;
  }
}

// Singleton instance
export const apiClient = new ApiClient();