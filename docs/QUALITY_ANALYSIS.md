# LLT Assistant - Quality Analysis Feature

## Overview

The Quality Analysis feature of LLT Assistant automatically detects quality issues in pytest test code and provides intelligent fix suggestions.

## Features

### 1. Automatic Test Quality Analysis
- 🔍 Automatically scans all test files in workspace (`test_*.py`)
- 🎯 Three analysis modes supported:
  - `rules-only`: Fast rule-based analysis
  - `llm-only`: AI-powered deep analysis
  - `hybrid`: Combined approach (default)

### 2. Visual Issue Display
- 📊 Activity Bar Tree View
  - Issues grouped by file
  - Shows severity and count
  - Click to jump to code location
- 🎨 Inline Decorations
  - Red wavy underline: Critical errors
  - Yellow solid underline: Warnings
  - Blue dotted underline: Info/suggestions
- 💬 Hover Tooltips
  - Detailed issue information
  - Fix suggestions with code preview
  - Detection source (Rule Engine/AI)

### 3. One-Click Fixes
- 💡 Click lightbulb icon for fix suggestions
- ✅ Accept fix with one click
- ❌ Reject suggestions
- 🔧 Three fix types:
  - Remove: Delete problematic code
  - Replace: Replace with suggested code
  - Add: Insert new code

### 4. Status Bar Integration
- 📈 Real-time analysis status
- 📊 Issue count display
- 🎯 Click to trigger analysis

## Usage

### 1. Start Analysis

**Method 1: Activity Bar**
1. Click the LLT Quality icon in the left Activity Bar (beaker icon)
2. Click the "Analyze" button (🧪) at the top

**Method 2: Command Palette**
1. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
2. Type "LLT: Analyze Test Quality"
3. Press Enter to execute

**Method 3: Status Bar**
1. Click the "LLT Quality" status bar item in the bottom right

### 2. View Issues

After analysis completes, issues are displayed in:

1. **Activity Bar Tree View**
   - Shows issue overview and statistics
   - Grouped by file
   - Click issue to jump to code

2. **Code Editor**
   - Color-coded underlines mark issues
   - Hover to see details

3. **Problems Panel**
   - Standard VSCode Problems panel
   - Filter by severity

### 3. Apply Fixes

1. Move cursor to the line with an issue
2. Wait for lightbulb 💡 icon (or press `Cmd+.` / `Ctrl+.`)
3. Click to view fix suggestions
4. Select "🔧 LLT: Fix xxx" to apply

### 4. Clear Issues

Click the "Clear" button ($(clear-all)) at the top of Activity Bar to remove all issue markers.

## Configuration

### Basic Settings

```json
{
  // Backend API URL
  "llt-assistant.quality.backendUrl": "http://localhost:8000/api/v1",

  // Analysis mode
  "llt-assistant.quality.analysisMode": "hybrid",

  // Auto-analyze when opening test files
  "llt-assistant.quality.autoAnalyze": false,

  // Enable inline decorations
  "llt-assistant.quality.enableInlineDecorations": true,

  // Enable code fix suggestions
  "llt-assistant.quality.enableCodeActions": true,

  // Severity filter
  "llt-assistant.quality.severityFilter": ["error", "warning", "info"],

  // Disabled rules
  "llt-assistant.quality.disabledRules": [],

  // LLM temperature parameter
  "llt-assistant.quality.llmTemperature": 0.3
}
```

### Configuration Details

#### backendUrl
Base URL for the backend API. Ensure the backend service is running.

#### analysisMode
- `rules-only`: Rule engine only, fast but may miss complex issues
- `llm-only`: AI analysis only, accurate but slower
- `hybrid`: Best of both (recommended)

#### autoAnalyze
Whether to automatically run analysis when opening test files (default: off).

#### enableInlineDecorations
Whether to show color-coded underlines in the code editor.

#### enableCodeActions
Whether to show fix suggestions (lightbulb feature).

#### severityFilter
Which severity levels to display:
- `error`: Critical errors, should be fixed
- `warning`: Warnings, recommended to fix
- `info`: Informational suggestions

#### disabledRules
List of rule IDs to disable, for example:
```json
["trivial-assertion", "unused-fixture"]
```

#### llmTemperature
AI analysis temperature parameter (0-1), lower values are more conservative.

## Detected Issue Types

1. **duplicate-assertion**: Duplicate or redundant assertions
2. **missing-assertion**: Missing necessary assertions
3. **trivial-assertion**: Meaningless assertions (e.g., `assert True`)
4. **vague-assertion**: Assertions that are too broad
5. **unused-fixture**: Declared but unused fixtures
6. **unused-variable**: Declared but unused variables
7. **test-mergeability**: Tests that can be merged
8. **assertion-inadequate**: Insufficient assertions
9. **naming-unclear**: Unclear naming
10. **code-smell**: General code quality issues

## Keyboard Shortcuts

| Action | Windows/Linux | Mac |
|--------|---------------|-----|
| Open Command Palette | `Ctrl+Shift+P` | `Cmd+Shift+P` |
| Show Quick Fix | `Ctrl+.` | `Cmd+.` |
| Open Settings | `Ctrl+,` | `Cmd+,` |

## Troubleshooting

### Backend Connection Failed

If you see "Cannot connect to LLT backend" error:

1. Verify backend service is running:
   ```bash
   curl http://localhost:8000/api/v1/health
   ```

2. Check that `backendUrl` in settings is correct

3. If using a custom port, update configuration:
   ```json
   {
     "llt-assistant.quality.backendUrl": "http://localhost:YOUR_PORT/api/v1"
   }
   ```

### No Test Files Found

Ensure test files follow these naming conventions:
- `test_*.py`
- `*_test.py`

And are not in these directories:
- `node_modules`
- `.venv` / `venv`
- `__pycache__`
- `dist` / `build`

### Decorations Not Showing

Check configuration:
```json
{
  "llt-assistant.quality.enableInlineDecorations": true
}
```

### Fix Suggestions Not Appearing

Check configuration:
```json
{
  "llt-assistant.quality.enableCodeActions": true
}
```

## Tech Stack

- **Frontend**: TypeScript + VSCode Extension API
- **HTTP Client**: axios
- **Backend**: LLT-Assistant-Backend (FastAPI)
- **Supported VSCode Version**: 1.85.0+

## Project Structure

```
src/quality/
├── activityBar/          # Tree view data provider
│   ├── provider.ts       # Tree view implementation
│   └── types.ts          # Data models
├── api/                  # Backend API client
│   ├── client.ts         # HTTP client
│   └── types.ts          # API type definitions
├── commands/             # Command implementations
│   └── analyze.ts        # Analysis command
├── decorations/          # Visualization components
│   ├── inline.ts         # Inline decorations
│   └── suggestions.ts    # Code fix suggestions
└── utils/                # Utility functions
    ├── config.ts         # Configuration manager
    └── statusBar.ts      # Status bar manager
```

## Development

### Compile

```bash
pnpm run compile
```

### Watch Mode

```bash
pnpm run watch
```

### Debug

1. Open project in VSCode
2. Press `F5` to launch Extension Development Host
3. Test the extension in the new window

## References

- [Backend API Documentation](https://github.com/Efan404/LLT-Assistant-Backend/blob/main/docs/api/openapi.yaml)
- [VSCode Extension API](https://code.visualstudio.com/api)
- [Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view)
- [Code Actions](https://code.visualstudio.com/api/language-extensions/programmatic-language-features#provide-code-actions)

## License

See LICENSE file in project root.
