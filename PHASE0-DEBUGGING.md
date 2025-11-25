# Phase 0 Debugging Guide

## 🔍 Problem Analysis

Based on the logs you provided, here are the issues:

### 1. Navigator Deprecation Warning
This is not related to our code, it's from the axios dependency. It's safe to ignore.

### 2. Document Selector Warning
This is also not critical - it's just informing us that we're using document selectors without scheme specification.

### 3. **No Output from Symbol Extraction**
This suggests the command is running but not finding symbols or not completing successfully.

## 🛠️ Debugging Steps

### Step 1: Run Diagnostic Command

I've added a new diagnostic command to help identify the issue:

1. Press `F5` to start Extension Development Host
2. Open your test file `test-files/phase0-sample.py`
3. Press `Ctrl+Shift+P` and run:
   - **"LLT Debug: Run Diagnostic"**

**What this does:**
- Tests if LSP can extract symbols from the current file
- Shows the results in Output panel
- Logs detailed information to Console

### Step 2: Check Console Logs

After running either command, check:
1. **Help → Toggle Developer Tools** in VSCode
2. Go to the Console tab
3. Look for logs starting with `[LLT Debug]`

### Step 3: Verify Common Issues

#### Issue 1: Python Extension Not Active
- Ensure you have the official Python extension installed
- The Python file should have syntax highlighting
- Try saving the file first (File was just created might not trigger LSP)

#### Issue 2: Python LSP Not Ready
- Python Language Server might need time to initialize
- Try waiting a few seconds after opening the file
- Make a small edit (add a space) and save to trigger LSP

#### Issue 3: Wrong File Type
- Check that VSCode shows "Python" in the bottom-right language indicator
- Not "Plain Text" or other language

## 📝 Updated Commands Available

After the fix, you now have TWO commands:

### 1. LLT Debug: Extract Symbols (Complete Extraction)
- Full symbol extraction as originally designed
- Includes imports, signatures, and call relationships
- Outputs detailed JSON to Output panel

### 2. LLT Debug: Run Diagnostic (Simple Check)
- Quick test to verify LSP is working
- Just checks if symbols can be extracted
- Shows count of found symbols

## 🔧 What Was Fixed

### 1. Enhanced Logging
Added detailed console logs at every step:
```
[LLT Debug] Starting symbol extraction...
[LLT Debug] Calling vscode.executeDocumentSymbolProvider...
[LLT Debug] Symbols received: X symbols
```

### 2. Improved Symbol Traversal
Updated the symbol traversal logic to recursively handle nested symbols:
- Functions inside classes
- Nested classes
- Multi-level hierarchies

### 3. Error Handling
Added try-catch blocks around function extraction to prevent crashes if individual functions fail.

### 4. Removed Unnecessary Async
Made `extractFunctionInfo` synchronous since it doesn't use async operations.

## 🎯 Expected Output Structure

When successful, you should see:

```json
{
  "file_path": "/path/to/test-files/phase0-sample.py",
  "extraction_time_ms": 47,
  "functions": [
    {
      "name": "calculate_tax",
      "kind": "function",
      "signature": "(price: float, region: str) -> float",
      "line_start": 4,
      "line_end": 8,
      "calls": ["get_tax_rate", "validate_price"],
      "decorates": [],
      "detail": ""
    },
    // ... more functions
  ],
  "imports": [
    {
      "module": "decimal",
      "imported_names": ["Decimal"],
      "alias": null
    }
  ]
}
```

## 🐛 If Still Not Working

If commands still don't produce output:

### 1. Check Developer Console
Look for errors like:
- "Cannot read property 'X' of undefined"
- "LSP provider not available"
- Network errors (if using remote LSP)

### 2. Try Different Approach
Try simplifying the test manually:
```typescript
// In VSCode Developer Tools Console
(await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', 
  vscode.window.activeTextEditor.document.uri))
```

### 3. Verify Python Extension
- Ensure Python extension by Microsoft is installed
- Check if it's enabled in the workspace
- Look for any Python extension errors

## 🤔 Common Causes & Solutions

| Problem | Symptom | Solution |
|---------|---------|----------|
| Python LSP not ready | No symbols found | Wait 5-10 seconds or make an edit |
| File not recognized as Python | Language indicator shows "Plain Text" | Click indicator and select "Python" |
| Syntax errors in file | LSP parsing fails | Fix syntax errors first |
| Python extension missing | No Python features | Install official Python extension |
| Workspace too large | LSP initialization slow | Wait longer or use smaller workspace |

## ✅ Success Indicators

When Phase 0 is working correctly:
1. **Command runs** without errors
2. **Status bar** shows "Symbol extraction completed in Xms"
3. **Output panel** contains JSON with function data
4. **Console logs** show consistent progress
5. **Functions** array contains 3 entries for sample file
6. **calculate_tax** has calls to ["get_tax_rate", "validate_price"]

## 🚀 Next Steps

Once symbol extraction works:
1. ✅ Frontend Phase 0 is complete
2. Move to Phase 1: Backend API endpoints
3. Move to Phase 2: Neo4j graph database integration
4. Move to Phase 3: Enhanced test generation with context

## 📞 Get More Help

If issues persist after trying these steps, provide:
1. Output from Developer Console (F1 → Developer: Toggle Developer Tools)
2. Output from "LLT Debug: Run Diagnostic" command
3. Screenshots of the Output panel
4. Python extension version (from Extensions sidebar)
