# LSP 等待机制测试步骤

## 🧪 测试方案

### 测试 1：完全重启（模拟第一次安装）

```bash
# 1. 完全关闭 VSCode
# 2. 重新打开 VSCode
# 3. 打开测试项目
# 4. 观察日志
```

**期望看到的日志：**
```
[LLT] Initializing Phase 1 Context System...
[LLT ProjectIndexer] Found 4 Python files
[LLT ProjectIndexer] Processing batch 1/1 (0-4)...
[LLT ProjectIndexer] Waiting for Python LSP to initialize...  <-- 新增！
[LSPWaiter] Waiting for Python LSP to be ready...           <-- 新增！
[LSPWaiter] Attempt 1: no symbols (100ms)                     <-- 新增！
[LSPWaiter] Attempt 2: 6 symbols found (650ms)               <-- 新增！ ✓
[LSPWaiter] ✓ LSP is ready after 650ms                       <-- 新增！ ✓
[SymbolExtraction] Extracting symbols from: ...
[SymbolExtraction] LSP returned 6 top-level symbols
[LLT ProjectIndexer] Valid files: 4, Empty files: 0
[LLT API] POST /context/projects/initialize
✅ 成功！
```

### 测试 2：快速重启（F5）

```bash
# 1. 在 Extension Development Host 中
# 2. Ctrl+Shift+P → Reload Window
# 3. 观察是否等待 LSP
```

### 测试 3：LSP 激活延迟测试

```bash
# 1. 关闭所有 Python 文件
# 2. 重启扩展
# 3. 在扩展初始化期间，快速打开一个 Python 文件
# 4. 观察 LSP 是否在扩展查询之前激活
```

### 测试 4：超时边界测试

```bash
# 模拟 LSP 永远不准备好的情况
# 期望行为：超时后仍然继续执行，并记录警告
```

## 📊 成功标准

### ✅ 测试通过的标志：

1. **日志中有 LSPWaiter 输出**
   ```
   [LSPWaiter] Waiting for Python LSP to be ready...
   [LSPWaiter] Attempt X: X symbols found
   [LSPWaiter] ✓ LSP is ready after Xms
   ```

2. **所有文件都提取到符号**
   ```
   Valid files: 4, Empty files: 0
   ```

3. **后端成功响应**
   ```
   Backend indexed X files, Y symbols
   ```

### ❌ 测试失败的标志：

1. **没有 LSPWaiter 日志**
   → 等待机制没有触发

2. **仍然返回 0 符号**
   ```
   Valid files: 0, Empty files: 4
   ```
   → 等待机制没有正常工作

3. **超时后继续失败**
   ```
   [LSPWaiter] Timeout after 5000ms
   ```
   → LSP 真的有问题，需要检查 Python 扩展

## 🎯 手动验证 LSP 状态

在 VSCode 命令面板中运行：

```
Ctrl+Shift+P → "Python: Show Output"
```

查看 Python 语言服务器的输出，确认它何时完成初始化。

或者运行：
```
Ctrl+Shift+P → "Developer: Show Running Extensions"
```

找到 "Python" 扩展，查看它的激活时间。

## 🔍 如果仍然失败

如果仍然看到 `Valid files: 0`，请检查：

1. **Python 扩展是否已安装**
   - 查看扩展面板是否有 "Python" (Microsoft)

2. **Python 解释器是否已选择**
   - 右下角应该显示 Python 版本
   - 点击它可以选择解释器

3. **在 Debug Console 中手动测试**
   ```javascript
   // 打开 Debug Console (Ctrl+Shift+Y)
   // 运行：
   const doc = vscode.window.activeTextEditor.document;
   const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', doc.uri);
   console.log('Symbols:', symbols ? symbols.length : 0);
   ```

4. **查看 Python 输出面板**
   ```
   Ctrl+Shift+P → "Python: Show Output"
   查看是否有错误信息
   ```