# 检查前端和后端连接配置

## 📋 当前配置状态

### ✅ 已配置项

1. **`.vscode/settings.json`**:
   ```json
   {
     "llt-assistant.maintenance.backendUrl": "https://cs5351.efan.dev/api/v1",
     "llt-assistant.backendUrl": "https://cs5351.efan.dev"
   }
   ```

2. **`src/maintenance/api/maintenanceClient.ts`**:
   - ✅ 使用 `/api/v1` 路径
   - ✅ 自动从配置读取URL
   - ✅ 支持回退到主backendUrl

### ❌ 需要添加的配置

1. **`package.json`** 中缺少维护模块的配置项：
   - 命令定义
   - 视图容器和视图
   - 配置项定义

2. **`src/extension.ts`** 中缺少维护模块的注册：
   - 导入维护模块
   - 注册命令
   - 注册视图

---

## 🔧 需要修复的内容

### 1. package.json 需要添加

#### 视图容器
```json
{
  "id": "llt-maintenance",
  "title": "LLT Maintenance",
  "icon": "resources/icons/llt-icon.svg"
}
```

#### 视图
```json
{
  "id": "lltMaintenanceExplorer",
  "name": "Dynamic Maintenance",
  "icon": "resources/icons/llt-icon.svg",
  "contextualTitle": "LLT Dynamic Maintenance"
}
```

#### 命令
```json
{
  "command": "llt-assistant.analyzeMaintenance",
  "title": "LLT: Analyze Maintenance",
  "icon": "$(git-commit)"
},
{
  "command": "llt-assistant.refreshMaintenanceView",
  "title": "LLT: Refresh Maintenance View",
  "icon": "$(refresh)"
},
{
  "command": "llt-assistant.clearMaintenanceAnalysis",
  "title": "LLT: Clear Maintenance Analysis",
  "icon": "$(clear-all)"
},
{
  "command": "llt-assistant.batchFixTests",
  "title": "LLT: Batch Fix Tests",
  "icon": "$(wrench)"
}
```

#### 配置项
```json
{
  "llt-assistant.maintenance.backendUrl": {
    "type": "string",
    "default": "https://cs5351.efan.dev/api/v1",
    "description": "Backend API URL for dynamic maintenance operations"
  },
  "llt-assistant.maintenance.autoAnalyze": {
    "type": "boolean",
    "default": false,
    "description": "Automatically analyze maintenance when new commits are detected"
  },
  "llt-assistant.maintenance.watchCommits": {
    "type": "boolean",
    "default": true,
    "description": "Enable watching for Git commits to trigger maintenance analysis"
  }
}
```

### 2. extension.ts 需要添加

```typescript
import {
  MaintenanceBackendClient,
  GitCommitWatcher,
  GitDiffAnalyzer,
  MaintenanceTreeProvider,
  AnalyzeMaintenanceCommand,
  BatchFixCommand,
  DecisionDialogManager
} from './maintenance';
import { MockMaintenanceBackendClient } from './maintenance/api/mockClient';

// 在 activate 函数中注册
const maintenanceClient = new MaintenanceBackendClient();
const maintenanceTreeProvider = new MaintenanceTreeProvider();
const decisionDialog = new DecisionDialogManager();

// 注册视图
const maintenanceTreeView = vscode.window.createTreeView('lltMaintenanceExplorer', {
  treeDataProvider: maintenanceTreeProvider,
  showCollapseAll: true
});
context.subscriptions.push(maintenanceTreeView);

// 注册命令
// ... (analyzeMaintenance, refreshMaintenanceView, clearMaintenance, batchFixTests)
```

---

## ✅ 验证步骤

1. **检查配置**:
   ```bash
   # 查看当前配置
   cat .vscode/settings.json
   ```

2. **检查API端点**:
   - 维护模块使用: `POST /maintenance/analyze`
   - 维护模块使用: `POST /maintenance/batch-fix`
   - 维护模块使用: `GET /health` (可选)

3. **测试连接**:
   - 编译扩展: `npm run compile`
   - 启动扩展开发主机: 按 `F5`
   - 执行命令: `LLT: Analyze Maintenance`
   - 查看输出面板的日志

---

## 🔍 API端点确认

### 维护模块的API端点

- **Base URL**: `https://cs5351.efan.dev/api/v1`
- **健康检查**: `GET /health` (可选)
- **分析维护**: `POST /maintenance/analyze`
- **批量修复**: `POST /maintenance/batch-fix`
- **代码差异**: `POST /maintenance/code-diff` (可选)

### 与组长修改后的API对比

组长的 `BackendApiClient` 使用:
- Base URL: `https://cs5351.efan.dev/api/v1` (从配置读取)
- 端点: `/workflows/generate-tests`, `/tasks/{task_id}`

维护模块使用:
- Base URL: `https://cs5351.efan.dev/api/v1` (从配置读取)
- 端点: `/maintenance/analyze`, `/maintenance/batch-fix`

**✅ 路径一致，配置正确！**

