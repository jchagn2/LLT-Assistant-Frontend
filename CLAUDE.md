# LLT Assistant VSCode Extension - Context Documentation

## Project Overview

The LLT Assistant is a VSCode extension that helps developers improve their Python test code quality. The extension has two main features:

1. **Test Generation** (Existing): Generates pytest unit tests using AI agents
2. **Test Quality Analysis** (New Feature): Analyzes pytest tests for quality issues and provides inline fix suggestions

## Current Status

**Date**: 2025-11-16

**Last Updated**: Project initialization for new quality analysis feature

## New Feature: Test Quality Analysis

### Goal
Build a quality analysis feature that integrates with a backend API to analyze pytest unit tests, display issues in a custom Activity Bar view, and provide inline fix suggestions similar to GitHub Copilot.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                VSCode Extension (TypeScript)             │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────┐ │
│  │   Activity   │───▶│   Backend    │───▶│  Inline  │ │
│  │   Bar View   │    │   Client     │    │  Actions │ │
│  └──────────────┘    └──────────────┘    └──────────┘ │
│         │                    │                   │      │
│         ▼                    ▼                   ▼      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────┐ │
│  │ Tree View    │    │   File       │    │  Code    │ │
│  │ Provider     │    │   Watcher    │    │  Actions │ │
│  └──────────────┘    └──────────────┘    └──────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. Activity Bar View (src/quality/)
- Custom Activity Bar icon and panel
- Tree view showing analysis results
- Issue grouping by file and severity
- Summary statistics

#### 2. Backend API Client (src/quality/api/)
- HTTP client for backend communication
- Request/response handling
- Error handling and retries
- Timeout management

#### 3. Issue Decorations (src/quality/decorations/)
- Inline highlighting of issues
- Color-coded by severity (red/yellow/blue)
- Hover tooltips with details

#### 4. Code Actions (src/quality/suggestions/)
- Quick fix suggestions
- Accept/reject functionality
- Code replacement/removal/addition

#### 5. Status Bar (src/quality/statusBar/)
- Real-time analysis status
- Quick access to commands
- Issue count display

### Backend API

**Base URL**:
- Development: `http://localhost:8000/api/v1`
- Production: `https://llt-assistant.fly.dev/api/v1`

**Endpoint**: `POST /workflows/analyze-quality`

**Request Format** (AnalyzeQualityRequest):
```json
{
  "files": [
    {
      "path": "tests/test_user.py",
      "content": "def test_example():\n    assert True"
    }
  ],
  "mode": "hybrid",
  "config": {
    "disabled_rules": [],
    "focus_on_changed_lines": false,
    "llm_temperature": 0.3
  },
  "client_metadata": {
    "extension_version": "0.1.0",
    "vscode_version": "1.85.0",
    "platform": "darwin",
    "workspace_hash": "abc123"
  }
}
```

**Response Format** (AnalyzeQualityResponse):
```json
{
  "analysis_id": "550e8400-e29b-41d4-a716-446655440000",
  "issues": [
    {
      "file": "tests/test_user.py",
      "line": 23,
      "column": 4,
      "severity": "error",
      "type": "trivial-assertion",
      "message": "This assertion is trivial and always passes",
      "detected_by": "rule_engine",
      "suggestion": {
        "action": "remove",
        "old_code": "assert True",
        "new_code": null,
        "explanation": "This assertion provides no value"
      }
    }
  ],
  "metrics": {
    "total_tests": 45,
    "issues_count": 12,
    "analysis_time_ms": 1234,
    "rules_applied": ["trivial-assertion", "missing-assertion"],
    "severity_breakdown": {
      "error": 3,
      "warning": 6,
      "info": 3
    }
  },
  "version_id": "v1_2024-11-16_abc123"
}
```

### Analysis Modes

1. **rules-only**: Fast analysis using only rule engine
2. **llm-only**: AI-powered analysis using only LLM
3. **hybrid**: Balanced - rule engine + LLM for uncertain cases (default)

### Issue Severity Levels

- **Error** (🔴): Critical issues that should be fixed
- **Warning** (🟡): Important issues to address
- **Info** (🔵): Suggestions for improvement

### Issue Types

Based on the backend API specification:

- **duplicate-assertion**: Duplicate or redundant assertions
- **missing-assertion**: Test lacks proper assertions
- **trivial-assertion**: Assertion that always passes (e.g., assert True)
- **vague-assertion**: Assertion is too weak or imprecise
- **unused-fixture**: Fixture declared but not used
- **unused-variable**: Variable assigned but never used
- **test-mergeability**: Multiple tests can be merged
- **assertion-inadequate**: Assertion doesn't properly validate behavior
- **naming-unclear**: Test or variable naming is unclear
- **code-smell**: General code quality issues

## Directory Structure

```
LLT-Assistant-VSCode/
├── src/
│   ├── extension.ts              # Main entry point
│   ├── quality/                  # NEW: Quality analysis feature
│   │   ├── activityBar/
│   │   │   ├── provider.ts       # Tree view data provider
│   │   │   ├── types.ts          # Data models
│   │   │   └── views.ts          # Custom view definitions
│   │   ├── api/
│   │   │   ├── client.ts         # Backend API client
│   │   │   └── types.ts          # API request/response types
│   │   ├── decorations/
│   │   │   ├── inline.ts         # Inline issue decorations
│   │   │   └── suggestions.ts    # Code action provider
│   │   ├── commands/
│   │   │   └── analyze.ts        # Analyze tests command
│   │   └── utils/
│   │       ├── config.ts         # Configuration manager
│   │       └── statusBar.ts      # Status bar manager
│   ├── agents/                   # Existing: Agent system
│   ├── analysis/                 # Existing: Code analysis
│   ├── api/                      # Existing: LLM API clients
│   ├── commands/                 # Existing: Commands
│   ├── generation/               # Existing: Test generation
│   ├── test/                     # Tests
│   ├── types/                    # Type definitions
│   ├── ui/                       # UI components
│   └── utils/                    # Utilities
├── resources/
│   └── icons/
│       └── llt-icon.svg          # NEW: Activity Bar icon
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript config
└── CLAUDE.md                     # This file
```

## Tech Stack

- **Language**: TypeScript
- **Runtime**: Node.js 18+
- **Framework**: VSCode Extension API
- **HTTP Client**: axios
- **Target VSCode**: 1.85.0+

## Development Guidelines

### Code and Documentation Language

**IMPORTANT**: All code comments, documentation, commit messages, and user-facing text MUST be written in English.

This includes:
- Code comments (inline and block)
- JSDoc/TSDoc comments
- README files
- Documentation files
- Commit messages
- Error messages
- UI text (notifications, tooltips, etc.)
- Configuration descriptions

**Exception**: User-facing UI text may be localized in the future, but the source should always be in English first.

## Development Phases

### Phase 1: Extension Setup & Infrastructure ✅
- [x] Project already initialized
- [x] Add quality analysis directories
- [x] Create Activity Bar icon (test tube with checkmark)
- [x] Update package.json with new contributions

### Phase 2: Activity Bar View Implementation ✅
- [x] Build Tree View Data Provider
- [x] Implement "Analyze Tests" button and command
- [x] Display analysis results in tree view

### Phase 3: Backend API Client ✅
- [x] Implement HTTP client with axios
- [x] Add request/response types
- [x] Error handling and retries

### Phase 4: Inline Suggestions & Code Actions ✅
- [x] Implement inline issue decorations
- [x] Code action provider for fix suggestions
- [x] Accept/reject functionality

### Phase 5: Configuration & Polish ✅
- [x] Add configuration options
- [x] Status bar integration
- [ ] Full end-to-end testing with backend

## Current Status (2025-11-16)

**All core features implemented!** ✅

The quality analysis feature is now complete with the following capabilities:

1. **Activity Bar Integration**
   - Custom icon in Activity Bar
   - Tree view showing issues grouped by file
   - Summary statistics

2. **Analysis Commands**
   - Analyze Tests: Scan all test files
   - Refresh: Re-run analysis
   - Clear: Remove all issues

3. **Backend Integration**
   - HTTP client with error handling
   - Support for all three analysis modes
   - Health check before analysis

4. **Visual Feedback**
   - Inline decorations (colored underlines)
   - Hover tooltips with details
   - Status bar updates
   - Problems panel integration

5. **Quick Fixes**
   - Code action provider (lightbulb)
   - Remove/Replace/Add suggestions
   - One-click acceptance

6. **Configuration**
   - Backend URL
   - Analysis mode (rules/llm/hybrid)
   - Feature toggles
   - Severity filters
   - Disabled rules

## Git Commits

1. **68bcfff** - feat: Add quality analysis infrastructure (Phase 1 & 2)
2. **8a8cad1** - feat: Complete quality analysis integration (Phase 2.2 & 5.2)
3. **8041868** - feat: Complete inline decorations and code actions (Phase 4)

## Configuration Options

The extension will support the following configuration:

```json
{
  "llt.backendUrl": "http://localhost:8000",
  "llt.analysisMode": "hybrid",
  "llt.autoAnalyze": false,
  "llt.enableInlineDecorations": true,
  "llt.enableCodeActions": true,
  "llt.severityFilter": ["error", "warning", "info"]
}
```

## User Workflows

### Workflow 1: Manual Analysis
1. User opens workspace with test files
2. User clicks LLT icon in Activity Bar
3. User clicks "Analyze Tests" button
4. Extension finds all `test_*.py` files
5. Extension sends files to backend
6. Backend returns analysis results
7. Extension shows results in tree view
8. Extension highlights issues inline
9. User hovers/clicks for fix suggestions
10. User accepts/rejects suggestions

### Workflow 2: Auto Analysis (Future)
1. User opens a test file
2. Extension automatically analyzes the file
3. Results appear immediately
4. User gets real-time feedback

## API Integration Details

### Backend Health Check
- Endpoint: `GET /health`
- Purpose: Check if backend is running
- Response: `200 OK`

### Test Analysis
- Endpoint: `POST /api/analyze`
- Purpose: Analyze test files for quality issues
- Timeout: 30 seconds
- Retry: 3 attempts for network errors

## Error Handling

### Network Errors
- Backend not reachable → Show "Cannot connect to LLT backend"
- Timeout → Show "Backend took too long to respond"

### Validation Errors
- Invalid request format → Show validation details
- Missing required fields → Show field-specific errors

### Server Errors
- 5xx errors → Show "Backend server error"
- Generic errors → Show error message with details

## Testing Strategy

### Unit Tests
- Test tree view data provider
- Test API client error handling
- Test decoration logic
- Test code action generation

### Integration Tests
- Test full analysis workflow
- Test with backend running
- Test with backend down
- Test with invalid responses

### Edge Cases
- Multiple test files with many issues
- Very large test files (>1000 lines)
- Rapid successive analysis requests
- Changing configuration during analysis
- Closing/opening files during analysis

## Next Steps

1. ✅ Create project structure for quality analysis
2. ⏭️ Implement Activity Bar view
3. ⏭️ Build backend API client
4. ⏭️ Add inline decorations
5. ⏭️ Implement code actions
6. ⏭️ Add configuration and polish
7. ⏭️ Test and debug

## Notes

- The existing test generation feature uses LLM APIs directly
- The new quality analysis feature uses a separate backend API
- Both features coexist independently
- Shared configuration manager can be extended for quality settings
- UI components can be reused where applicable

## References

- VSCode Extension API: https://code.visualstudio.com/api
- Tree View API: https://code.visualstudio.com/api/extension-guides/tree-view
- Code Actions: https://code.visualstudio.com/api/language-extensions/programmatic-language-features#provide-code-actions
- Decorations: https://code.visualstudio.com/api/references/vscode-api#DecorationOptions
