# Frontend Refactoring and Lifecycle Management

This document outlines the problems identified in the VSCode extension's frontend and the implementation details of the solutions.

## 1. Problems Addressed

### Problem 1: Premature Indexing on Activation
The extension initiated project indexing immediately upon activation, often before the Python Language Server (LSP) was fully initialized. This resulted in a race condition where the symbol provider would return no symbols, leading to an empty project index.

### Problem 2: Inadequate Lifecycle and Cache Management
The extension lacked robust lifecycle management. It would attempt to re-initialize the project on every startup without validating the existing local cache or checking the project's status on the backend. This caused unnecessary re-indexing and lacked a proper re-index or cache invalidation flow.

### Problem 3: Poor Error Handling
Backend API errors (e.g., connection refused, project not found) were not handled gracefully. The user was not presented with clear error messages or actionable recovery options, leading to a confusing user experience.

## 2. Solution Implemented

A multi-phase solution was implemented to address these issues, focusing on robust asynchronous initialization, comprehensive cache validation, and user-friendly error feedback.

### Solution 1: Deferred Initialization and LSP Readiness Check
- **Delayed Start:** The indexing process is now deferred by 3 seconds after extension activation to give the LSP a head start.
- **Active LSP Probing:** After the delay, the extension actively probes the LSP by attempting to fetch symbols for a Python file.
- **Exponential Backoff:** If the LSP is not ready, the extension automatically retries the check up to 5 times with an exponentially increasing delay (500ms, 1s, 2s, 4s, 8s).
- **Graceful Failure:** If the LSP is still not ready after all retries, the indexing is postponed, and the user is notified with options to retry manually. The Activity Bar view is updated to show an "LSP Not Ready" status.

### Solution 2: Cache Validation and Lifecycle Hooks
- **Multi-Layered Cache Validation:** Before using the cached project context, a comprehensive validation check is performed:
    1.  **Schema Version:** Ensures the cache structure is up-to-date.
    2.  **Workspace Path:** Verifies the cache belongs to the currently open workspace.
    3.  **Cache Age:** Invalidates the cache if it's older than 30 days.
    4.  **Backend Existence:** Makes an API call to `GET /context/projects/{id}/status` to ensure the project still exists on the backend.
- **Lifecycle Logic:** The startup logic now correctly handles different scenarios:
    - **First-time indexing:** If no cache is present.
    - **Invalid cache:** If any validation check fails, the user is prompted to re-index.
    - **Valid cache:** The extension loads from the cache for a near-instant startup.

### Solution 3: Robust Error Handling and UI Feedback
- **Backend Unavailability:** If API calls fail due to connection errors (`ECONNREFUSED`), the UI now enters a "Backend Unavailable" state, and the user is given options to "Retry" or "Open Settings".
- **Clear Status Views:** The "LLT Context" Activity Bar view was significantly enhanced to provide real-time status updates, including:
    - `Initializing...`
    - `Waiting for LSP...`
    - `LSP Not Ready`
    - `Indexing...` (with progress)
    - `Indexed` (with statistics)
    - `Cache Outdated`
    - `Backend Unavailable`
- **Re-indexing Command:** A `llt.reindexProject` command was improved to run the full, robust startup logic, including the LSP check.

## 3. Changed Files

-   `src/extension.ts`: Main orchestrator for the new activation and indexing lifecycle.
-   `src/utils/lspWaiter.ts`: (New file) Contains the logic for waiting for the LSP with exponential backoff.
-   `src/views/ContextStatusView.ts`: Updated to display the new detailed status messages.
-   `src/services/ApiClient.ts`: Added the `getProjectStatus` method to support backend cache validation.
-   `src/services/ContextState.ts`: Updated to make `isValid()` asynchronous and include the backend check.
-   `src/services/ProjectIndexer.ts`: Removed a redundant and conflicting LSP check to centralize the logic in `extension.ts`.
