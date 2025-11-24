/**
 * Test Code Generation Module
 *
 * Exports all functionality for parsing, validating, formatting,
 * inserting generated test code, and CodeLens integration.
 */

// Main controller
export { TestGenerationController } from './test-generator';

// CodeLens provider
export { TestGenerationCodeLensProvider } from './codelens-provider';

// Status bar manager
export { TestGenerationStatusBar } from './status-bar-manager';

// Type exports
export * from './types';
