# F2 Coverage Optimization - 联调测试报告

## 测试环境

| 项目 | 值 |
|------|-----|
| 后端 URL | http://localhost:8886 |
| 扩展版本 | 0.0.1 |
| 测试时间 | 2025-11-26 |
| 测试项目 | test_coverage_project |

---

## API 端点验证

### 1. Health Check

```bash
curl http://localhost:8886/health
```

**响应:**
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "services": {
    "api": {"status": "up"},
    "neo4j": {"status": "up", "response_time_ms": 1}
  }
}
```

**结果:** ✅ 通过

---

### 2. POST /optimization/coverage (创建任务)

**请求:**
```json
{
  "source_code": "def add(a,b): return a+b",
  "existing_test_code": "",
  "uncovered_ranges": [{"start_line": 1, "end_line": 1, "type": "line"}],
  "framework": "pytest"
}
```

**响应:**
```json
{
  "task_id": "0a5c644f-8223-49d8-abcf-4b6b1acd815d",
  "status": "pending",
  "estimated_time_seconds": 30
}
```

**结果:** ✅ 通过 - 正确返回 task_id 和 pending 状态

---

### 3. GET /tasks/{task_id} (轮询结果)

**响应 (completed):**
```json
{
  "task_id": "0a5c644f-8223-49d8-abcf-4b6b1acd815d",
  "status": "completed",
  "result": {
    "recommended_tests": [
      {
        "test_code": "def test_add_positive_numbers():\n    assert add(2, 3) == 5",
        "target_line": 1,
        "scenario_description": "Test basic addition functionality",
        "expected_coverage_impact": "Covers line 1 in add function"
      }
      // ... 共 6 个测试用例
    ]
  }
}
```

**结果:** ✅ 通过 - 正确返回 recommended_tests 数组

---

### 4. Error Handling (debug_options 模拟失败)

**请求:**
```json
{
  "source_code": "def add(a,b): return a+b",
  "existing_test_code": "",
  "uncovered_ranges": [{"start_line": 1, "end_line": 1, "type": "line"}],
  "framework": "pytest",
  "debug_options": {
    "simulate_error": true,
    "error_message": "模拟的 LLM 调用超时"
  }
}
```

**轮询响应 (failed):**
```json
{
  "task_id": "3d441568-0f5f-4dd9-9f43-b06374701920",
  "status": "failed",
  "error": {
    "message": "模拟的 LLM 调用超时",
    "code": null,
    "details": null
  }
}
```

**结果:** ✅ 通过 - 错误信息正确传递

---

## 测试结果汇总

### Test Case 1: Happy Path (API 层)

| 步骤 | 结果 | 备注 |
|------|------|------|
| 后端健康检查 | ✅ | version 0.1.0, all services up |
| POST /optimization/coverage | ✅ | 返回 task_id 和 pending 状态 |
| GET /tasks/{task_id} 轮询 | ✅ | 状态正确转换 pending → completed |
| 结果解析 | ✅ | recommended_tests 数组包含 6 个测试 |
| 测试代码结构 | ✅ | 包含 test_code, target_line, scenario_description |

### Test Case 2: Error Handling (API 层)

| 场景 | 结果 | 备注 |
|------|------|------|
| debug_options 模拟失败 | ✅ | status: "failed" 正确返回 |
| error.message 传递 | ✅ | "模拟的 LLM 调用超时" 正确显示 |
| error 结构 | ✅ | 包含 message, code, details 字段 |

---

## 代码变更

### 1. 添加 DebugOptions 类型支持

**文件:** `src/coverage/api/types.ts`

```typescript
/**
 * Debug options for testing error handling
 */
export interface DebugOptions {
    simulate_error?: boolean;
    error_message?: string;
    error_code?: string | null;
}

export interface CoverageOptimizationRequest {
    source_code: string;
    existing_test_code: string;
    uncovered_ranges: UncoveredRange[];
    framework: string;
    debug_options?: DebugOptions;  // 新增
}
```

**状态:** ✅ 已完成并编译通过

---

## 测试项目

**位置:** `test_coverage_project/`

**结构:**
```
test_coverage_project/
├── coverage.xml          # 覆盖率报告
├── src/
│   └── simple_math.py    # 源代码 (add, subtract, multiply, divide)
└── test_simple_math.py   # 现有测试
```

**覆盖率缺口:**
- `multiply()` 函数的 `result > 100` 分支未覆盖
- `divide()` 函数完全未覆盖

---

## 待验证项 (需要 VSCode UI 手动测试)

以下测试需要在 VSCode 中手动执行：

| 测试项 | 状态 | 说明 |
|--------|------|------|
| Analyze Coverage 按钮 | ⏳ 待测 | 点击后显示覆盖率和未覆盖函数 |
| 未覆盖函数高亮 | ⏳ 待测 | 红色背景装饰器 |
| CodeLens Yes/No 按钮 | ⏳ 待测 | 出现在未覆盖代码上方 |
| 绿色预览装饰器 | ⏳ 待测 | 生成的测试代码显示绿色背景 |
| Accept 按钮 | ⏳ 待测 | 保留代码，移除装饰器 |
| Discard 按钮 | ⏳ 待测 | 删除代码和装饰器 |
| 错误信息显示 | ⏳ 待测 | 使用 debug_options 验证错误提示 |

---

## 结论

### API 层测试
- ✅ **所有 API 端点正常工作**
- ✅ **请求/响应结构符合预期**
- ✅ **错误模拟功能 (debug_options) 工作正常**
- ✅ **类型定义已更新支持 debug_options**

### 下一步
1. 在 VSCode 中进行完整 UI 流程测试
2. 验证 InlinePreviewManager 和 CodeLens 按钮功能
3. 测试 Accept/Discard 交互

---

## 附录: 测试命令

```bash
# 健康检查
curl http://localhost:8886/health

# 创建优化任务
curl -X POST http://localhost:8886/optimization/coverage \
  -H "Content-Type: application/json" \
  -d '{"source_code":"...", "existing_test_code":"", "uncovered_ranges":[], "framework":"pytest"}'

# 轮询任务状态
curl http://localhost:8886/tasks/{task_id}

# 模拟错误
curl -X POST http://localhost:8886/optimization/coverage \
  -H "Content-Type: application/json" \
  -d '{"...", "debug_options":{"simulate_error":true, "error_message":"测试错误"}}'
```
