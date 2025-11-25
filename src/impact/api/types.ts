/**
 * Backend API Types for Impact Analysis
 * Based on the /analysis/impact endpoint specification
 */

import { AffectedTest } from '../models/types';

/**
 * Request interface - match backend ImpactAnalysisRequest
 */
export interface ImpactAnalysisRequest {
  project_context: {
    files_changed: Array<{
      path: string;
      change_type: "modified" | "added" | "removed";
    }>;
    related_tests: Array<string>;
  };
  git_diff?: string;
  project_id: string;
  client_metadata?: ClientMetadata;
}

/**
 * Response interface
 */
export interface ImpactAnalysisResponse {
  context_id: string;
  impacted_tests: AffectedTest[];
  summary?: {
    change_type: string;
    lines_changed: number;
  };
}

/**
 * Client metadata for tracking
 */
export interface ClientMetadata {
  extension_version?: string;
  vscode_version?: string;
  platform?: string;
  workspace_hash?: string;
}

/**
 * Backend error types
 */
export type BackendErrorType =
  | 'network'
  | 'validation'
  | 'server'
  | 'http'
  | 'timeout'
  | 'unknown';

/**
 * Backend error
 */
export interface BackendError {
  type: BackendErrorType;
  message: string;
  detail: string;
  statusCode: number;
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  status: string;
  version?: string;
}