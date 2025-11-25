## [Feature 1] Frontend Regeneration Mode Detection

**Status:** Open  
**Impact:** Low (LLM Context Context only)  
**Priority:** Medium

### Description

The `mode` variable in `registerGenerateTestsCommand` defaults to 'new'. It should auto-detect 'regenerate' if `existingTestCode` is found.

### Technical Details

**Location:** `src/extension.ts` line 448

**Current Code:**
```typescript
const mode = args?.mode || 'new';
```

**Expected Behavior:**
```typescript
const existingTestFilePath = await CodeAnalyzer.findExistingTestFile(filePath);
const mode = existingTestFilePath ? 'regenerate' : (args?.mode || 'new');
```

### Impact Analysis

**Frontend Impact:** Low
- UI flows work correctly (prompt only shows for mode === 'new')
- `existing_test_code` is correctly passed to backend

**Backend Impact:** Low
- Backend uses `mode` as LLM context/prompt only
- No hard control flow branches based on mode value
- `user_description` field is primary indicator for regeneration

### Complexity

**Medium**

**Reason:** Requires refactoring the User Input logic (line 493) to decouple from the initial `mode` variable, allowing `mode` to be finalized after checking for existing files.

**Risk:** High - Changes to variable scope may break TypeScript compilation and affect UI prompts

### Recommended Approach

Schedule as part of next code quality sprint or when refactoring the test generation command.

**Estimated Effort:** 30 minutes including testing

### Workaround

Current implementation is functional. Backend receives both:
1. `existing_test_code` - actual code for analysis
2. `user_description` - clearly indicates "Regenerate tests..."

These provide sufficient context for LLM to generate appropriate tests.
