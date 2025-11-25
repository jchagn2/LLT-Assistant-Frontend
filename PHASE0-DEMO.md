# Phase 0 Feature Demonstration Guide

## 🎬 Interactive Demonstration Steps

### Preparation

```bash
# 1. Compile the project
npm run compile

# 2. If watch mode is not running, start it
npm run watch
```

### Demonstration Flow

#### Step 1: Start Extension Development Host

- Press **F5** in VSCode
- Or use the debug panel to launch "Run Extension"

> A new window will open with "[Extension Development Host]" in the title bar

#### Step 2: Open Test File

In the new window:
- Use `File → Open File`
- Select: `test-files/phase0-sample.py`

Or press `Ctrl+O` and navigate to the test file

#### Step 3: Trigger Symbol Extraction Command

- Press `Ctrl+Shift+P` to open Command Palette
- Type: `LLT Debug: Extract Symbols`
- The command will auto-complete
- Press `Enter` to execute

#### Step 4: Observe Output

**Status Bar**: Briefly shows "Extracting symbols from current file..."

**When Complete**: Popup message "Symbol extraction completed in Xms"

#### Step 5: View Detailed Results

1. Open Output panel: `View → Output` (or press `Ctrl+Shift+U`)
2. In the bottom-right dropdown, select: "LLT Assistant"
3. View the JSON-formatted extraction results

### 📊 Expected Output Detailed Analysis

```json
{
  "file_path": "/Users/username/project/test-files/phase0-sample.py",
  "extraction_time_ms": 47,
  "functions": [
    {
      "name": "calculate_tax",
      "kind": "function",
      "signature": "(price: float, region: str) -> float",
      "line_start": 4,
      "line_end": 8,
      "calls": [
        "get_tax_rate",
        "validate_price"
      ],
      "decorates": [],
      "detail": ""
    },
    {
      "name": "get_tax_rate",
      "kind": "function",
      "signature": "(region: str) -> float",
      "line_start": 10,
      "line_end": 14,
      "calls": [],
      "decorates": [],
      "detail": ""
    },
    {
      "name": "validate_price",
      "kind": "function",
      "signature": "(price: float) -> float",
      "line_start": 16,
      "line_end": 20,
      "calls": [],
      "decorates": [],
      "detail": ""
    }
  ],
  "imports": [
    {
      "module": "decimal",
      "imported_names": [
        "Decimal"
      ],
      "alias": null
    }
  ]
}
```

### 🎯 Key Verification Points

#### ✅ Verification 1: Function Signature Extraction
- `calculate_tax` correctly extracts `(price: float, region: str) -> float`
- Includes parameter types and return type

#### ✅ Verification 2: Call Relationship Identification
- `calculate_tax`'s `calls` array contains `get_tax_rate` and `validate_price`
- Proves successful identification of function dependencies

#### ✅ Verification 3: Import Parsing
- Correctly identifies `from decimal import Decimal`
- Module name: `decimal`
- Imported names: `["Decimal"]`

#### ✅ Verification 4: Line Number Range
- Line numbers start from 0 (VSCode standard)
- Range accurately covers function body

### 🔍 Advanced Testing: Edge Cases

#### Test 1: Complex Import Statements

Create test file `test-files/complex-imports.py`:

```python
import json
import sys as system
from typing import List, Dict, Optional
from pathlib import Path
import json, csv

def process_data(items: List[Dict]) -> Optional[Dict]:
    path = Path("data.json")
    data = json.loads(path.read_text())
    return data
```

**Expected**: Extract all import statements

#### Test 2: Nested Calls

```python
def outer():
    return inner()

def inner():
    return helper()

def helper():
    return 42
```

**Expected**: `outer` → `inner`, `inner` → `helper`

#### Test 3: Class Methods

```python
class Calculator:
    def calculate(self, x: int) -> int:
        return self._validate(x) * 2
    
    def _validate(self, x: int) -> int:
        return max(0, x)
```

**Expected**:
- `calculate` method detects `self._validate` call
- `kind` is "method"

### 🐛 Error Handling Demonstration

#### Scenario 1: Non-Python File
- Open a `.txt` file
- Run the command
- **Expected**: Shows "Not a Python file" prompt

#### Scenario 2: Empty File or No Functions
- Create empty file `empty.py`
- Run the command
- **Expected**: Shows "No symbols found in this file" prompt

#### Scenario 3: Syntax Error
- Create file with syntax errors
- Run the command
- **Expected**: LSP may not extract symbols, shows warning

### 📈 Performance Metrics

In typical Python files (< 500 lines):

- **Symbol Extraction Time**: < 50ms
- **Call Relationship Extraction**: < 100ms
- **Total Execution Time**: < 200ms

In large files (> 1000 lines):
- **Total Execution Time**: < 1 second

### 🎓 Technical Highlights Demonstration

#### Highlight 1: Power of LSP API
```typescript
// Single line to get all symbols
const symbols = await vscode.commands.executeCommand(
  'vscode.executeDocumentSymbolProvider',
  document.uri
);
```

#### Highlight 2: Intelligent Call Extraction
```typescript
// Filter common non-mock objects
const skipList = ['if', 'elif', 'for', 'while', 'return', 'print', 
                  'len', 'range', 'enumerate', ...];
if (!skipList.includes(functionName)) {
  calls.push(functionName);
}
```

#### Highlight 3: Clear Output Format
- JSON structured data
- Easy to parse and process
- Includes metadata (execution time)

### 🔄 Comparison with Existing Features

**Before (Features 1-4)**:
- Only passed source code string
- Backend didn't know function dependencies
- Generated test quality was limited

**Now (Phase 0 POC)**:
- Frontend extracts rich symbol information
- Identifies function call relationships
- Lays foundation for high-quality test generation

### 📝 Demonstration Checklist

When presenting to the team, ensure to validate:

- [ ] Command is visible in Command Palette
- [ ] Can correctly extract 3 functions
- [ ] calculate_tax's calls array contains get_tax_rate and validate_price
- [ ] Import decimal is correctly extracted
- [ ] Execution time is less than 1 second
- [ ] JSON format is valid and readable
- [ ] Error handling works correctly

### 🎉 Next Demonstration Scenarios

After demonstrating Phase 0, you can show how to:

1. **Send to Backend API** (Phase 1)
2. **Store in Neo4j** (Phase 2)
3. **Improve Test Generation Quality** (Phase 3)

### 🚧 Candidly Present Known Limitations

Mention these proactively during demonstration:

1. **Call Extraction is Not 100% Accurate**
   - Uses regex, has limitations
   - Phase 0 goal is to validate feasibility

2. **LSP May Have Initial Delay**
   - First extraction may occur while LSP is loading
   - Usually fast on second try

3. **Type Info Depends on Annotations**
   - Functions without type annotations have simplified signatures
   - This is Python's dynamic nature

### 🎯 Demonstration Goals

**Key Messages to Convey**:
- ✅ We **can** extract needed symbol information
- ✅ VSCode LSP API is **powerful enough**
- ✅ The technical approach is **feasible**
- ✅ Lays foundation for high-quality test generation

**Expected Audience Reaction**:
- "Wow, VSCode provides so much information!"
- "This JSON structure is clear and easy to process"
- "Phase 0 proves this direction is right"
