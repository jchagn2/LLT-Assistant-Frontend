# Coverage Feature Tests

This directory contains unit tests for the Coverage Optimization feature (F2).

## Test Structure

```
src/test/unit/coverage/
├── xml-parser.test.ts      # Tests for XML parsing and path resolution
├── commands.test.ts        # Tests for command handlers and file operations
├── fixtures/               # Test data files
│   ├── valid-coverage.xml
│   └── app-prefix-coverage.xml
└── README.md               # This file
```

## What These Tests Cover

### XML Parser Tests (`xml-parser.test.ts`)
- ✅ Valid coverage.xml parsing
- ✅ Nested path handling
- ✅ Invalid XML error handling
- ✅ **Path resolution with common Python project patterns (app/, src/, etc.)** ← Fixes the bug
- ✅ Absolute vs relative path handling
- ✅ Non-existent file path warnings
- ✅ Coverage statistics extraction
- ✅ Edge cases (empty reports, no branches)

### Command Tests (`commands.test.ts`)
- ✅ **File existence check before opening** ← Fixes the bug
- ✅ User-friendly error messages when file not found
- ✅ Re-analyze coverage workflow
- ✅ File highlighting and navigation
- ✅ Error handling
- ✅ Line number conversion (1-based to 0-based)
- ✅ Tree provider integration

## Running Tests

```bash
# Run all unit tests
npm run test:unit

# Run coverage tests specifically
npm run test:unit -- --grep "Coverage"

# Run with coverage report
npm run test:coverage
```

## Test Fixtures

- `valid-coverage.xml`: Standard coverage report with multiple files
- `app-prefix-coverage.xml`: Coverage report with paths requiring app/ prefix resolution

## Related Bug Fixes

These tests were added to prevent regression of:
1. **Command not found error**: `llt-assistant.showCoverageItem` not registered
2. **File not found error**: Paths in coverage.xml not resolving correctly (missing app/ prefix)

## Future Improvements

- [ ] Add integration tests for full coverage analysis workflow
- [ ] Add property-based tests for path resolution edge cases
- [ ] Mock VSCode workspace for more isolated testing
- [ ] Add tests for CodeLens interaction
- [ ] Test multi-workspace scenarios
