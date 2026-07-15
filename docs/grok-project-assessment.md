# AI History Recall — 项目审查评估报告

| 元信息 | 内容 |
|--------|------|
| **评估方** | **Grok**（xAI） |
| **评估日期** | 2026-07-11 |
| **评估对象** | AI History Recall（本地工作区快照） |
| **审查范围** | 代码结构、架构、数据层、采集链路、安全、工程化、产品完成度 |
| **审查方式** | 只读分析（源码、schema、扩展、依赖、本地 DB 统计、`tsc` / `eslint`） |
| **结论等级** | 有真实用户价值的本地 MVP，采集能力已跑通；工程成熟度与可维护性仍处早期 |

> 本文档由 Grok 基于项目源码与运行时数据出具，用于记录一次完整的项目审查结论与改进路线图。  
> 非自动生成的流水线扫描报告；结论依赖当时工作区状态，后续代码变更后请重新评估关键章节。

---

## 1. 一句话结论

这是一个定位清晰的 **本地优先 AI 对话召回工具**：导入 + 浏览器采集 → SQLite + FTS5 → 搜索 / 标签 / 备注。产品叙事与技术选型匹配，**本地数据已有实战验证**（约 527 对话 / 2870 消息，覆盖 ChatGPT / Gemini / DeepSeek / Qwen）。

主要短板在：**采集层复杂度失控、API 无鉴权、依赖与锁文件不稳、零测试、无 Git 仓库、平台官方导出 adapter 仍是空壳**。

| 维度 | 评分 (1–10) | 简评 |
|------|------------|------|
| 产品定位与文档 | 9 | README 详尽，场景清晰 |
| 数据模型与导入闭环 | 8 | schema 合理，事务导入 + 去重可用 |
| 采集能力（扩展 + CDP） | 7 | 已跑通四平台，但实现很重、脆弱 |
| 搜索与详情体验 | 7 | FTS5 + 高亮可用；中文分词弱 |
| 代码可维护性 | 4 | 超大单文件、逻辑重复、组件膨胀 |
| 安全（本地威胁模型） | 4 | 无鉴权 API，任意进程可写库 |
| 工程化（版本/测试/CI） | 3 | `latest` 依赖、双锁文件、无测试、无 git |
| **整体成熟度** | **6 / 10** | 个人可用的强 MVP；距“可长期维护产品”还有明显差距 |

---

## 2. 项目是什么

### 2.1 核心价值

> AI 工具越用越多，问题资产在失忆。把散落在各平台的历史对话召回本地，可搜、可标、可复用。

### 2.2 技术栈

- **Web**：Next.js App Router + React + Tailwind + TypeScript
- **存储**：SQLite（`better-sqlite3`）+ FTS5
- **采集**：Chrome 扩展（推荐）+ Playwright CDP（高级备用）
- **可选 LLM**：仅用于生成采集计划（OpenAI-compatible），默认本地规则

### 2.3 架构示意

```text
┌─────────────────┐     ┌──────────────────────┐
│  文件导入        │     │  Chrome 扩展 / CDP    │
│  txt/md/json/html│     │  四平台 DOM/API 发现  │
└────────┬────────┘     └──────────┬───────────┘
         │                         │
         ▼                         ▼
   import adapters          extension/capture APIs
         │                         │
         └───────────┬─────────────┘
                     ▼
              import-service
           (事务写入 + source_url 去重)
                     ▼
        SQLite: conversations / messages
                tags / notes / FTS5
                capture_jobs / targets / discovery_runs
                     ▼
           search / detail / metadata UI
```

### 2.4 本地数据实况（审查时）

| 指标 | 数值 |
|------|------|
| 对话数 | 527 |
| 消息数 | 2,870 |
| DB 体积 | ~18MB（`data/` 合计 ~22MB） |
| chatgpt | 81 |
| gemini | 237 |
| deepseek | 71 |
| qwen | 138 |

说明产品已不只是脚手架，**采集 → 入库 → 检索**链路在真实环境里走过。

### 2.5 代码体量

- 业务源码约 **1.1 万行**（`src` + `extension`）
- 热点文件：
  - `src/components/CapturePlanner.tsx` ~1824 行
  - `extension/background.js` ~1329 行
  - `extension/content.js` ~1289 行
  - 三者合计约 **4400 行**，接近总代码量的 40%

---

## 3. 做得好的地方

1. **定位克制且正确**  
   不做云聊天、不做同步，先做“召回 + 本地资产”。隐私叙事与实现一致（默认不上云）。

2. **数据层设计扎实**  
   - 外键 + CASCADE  
   - FTS5 索引  
   - `(source_platform, source_url)` 部分唯一索引去重  
   - 轻量 `migrateDatabase` 兼容旧库  
   - 导入使用事务，失败可回滚  

3. **采集问题抓得准**  
   登录态是核心难点：扩展走日常 Chrome session，比独立 CDP profile 更实用；节流、队列持久化、`chrome.alarms` 抗 MV3 挂起、discovery 审计证据，都是真实踩坑后的设计。

4. **服务分层清晰（后端）**  
   `services/*` + `import/adapters/*` + `capture/*` 边界大体清楚，API route 多数是薄封装。

5. **文档质量高**  
   根 README 与 `extension/README.md` 覆盖安装、采集路径、API 示例、隐私说明与 TODO，对新人或自己日后回来都友好。

6. **基础质量门禁目前是绿的**  
   `tsc --noEmit` 通过，`eslint` 通过（审查时）。

---

## 4. 主要问题（按严重度）

### P0 — 安全与本地威胁模型

| 问题 | 说明 | 位置 |
|------|------|------|
| **所有 API 无鉴权** | 任意本机进程可 `POST /api/extension/capture-page` 写入对话、触发浏览器/CDP 动作、读审计 | `src/app/api/**` |
| **扩展硬编码 localhost:3000** | 无 token/shared secret；同机恶意页面若能触达扩展消息面需再评估 | `extension/background.js` L1–4 |
| **CDP 可被远程驱动** | `/api/capture/chrome*`、`/browser`、`/agent` 可驱动本机 Chrome | `src/services/chrome-cdp-service.ts` 等 |

**评估**：对“只跑在自己电脑、不对外暴露 3000 端口”的个人工具可接受；一旦 `next start` 绑定到局域网/公网，风险立刻升高。

**建议**：本机 shared secret（header token）、默认只监听 `127.0.0.1`、危险 API 二次确认或开发态开关。

### P0 — 工程可复现性

| 问题 | 说明 |
|------|------|
| **依赖全是 `"latest"`** | `next` / `react` / `better-sqlite3` 等均可漂移，构建不可复现 |
| **双锁文件** | 同时存在 `package-lock.json` 与 `pnpm-lock.yaml`，README 写 npm，workspace 是 pnpm 半成品 |
| **`pnpm-workspace.yaml` 异常** | 内容像 `onlyBuiltDependencies` 提示文本，不是正常 workspace 配置 |
| **无 Git 仓库** | 当前目录非 git 仓库，无版本历史、难回滚、难协作 |
| **硬编码本机绝对路径** | `CapturePlanner.tsx` 曾存在本机 workspace 绝对路径，需改为可配置路径 |

### P1 — 可维护性债务

1. **God Component / God Script**  
   - `CapturePlanner.tsx` 集 UI、轮询、auto-pilot、扩展桥、审计、CDP、任务批跑于一体  
   - `background.js` / `content.js` 无模块拆分、无 TypeScript  

2. **平台提取逻辑双份维护**  
   `src/capture/platforms.ts` 与 `extension/content.js` 各自实现 ChatGPT/Gemini/DeepSeek/Qwen 选择器，平台改版时极易只修一边。

3. **Schema 迁移重复**  
   `schema.sql` 与 `lib/db.ts` 的 `migrateDatabase`、甚至 `capture-audit-service` 内 `ensureAuditSchema` 多处建表/加列，长期易漂移。

4. **官方导出 Adapter 空壳**  
   `chatgpt.ts` / `claude.ts` / `deepseek.ts` / `qwen.ts` 的 `canHandle() { return false }`，README 写“已预留”属实，但用户若期望官方 export 会落空。

5. **导入去重不更新**  
   同 `source_url` 直接 `skippedDuplicates`，对话内容更新后不会刷新消息与 FTS（适合“只导入一次”，不适合“持续同步”）。

### P1 — 产品能力缺口（对照 README TODO）

- 无批量删除 / 重新索引  
- 中文 FTS 仅 `unicode61`，短语/无空格中文检索体验有限  
- 无导出 Markdown/JSON  
- 无语义搜索 / embedding  
- 无测试（单元 / 集成 / e2e）  
- 无 CI  

### P2 — 体验与一致性

- 扩展版本号与文档易不同步：`manifest.json` `0.1.38`，README 仍写 `0.1.37 / chatgpt-api-zero-fallback-...`，代码期望 `no-debugger-input-20260711`  
- 高级调试区与“一键向导”并存，`CapturePlanner` 心智负担高  
- `data/*.json` 大量 capture 中间文件被 gitignore，但本地堆积需清理策略  
- `better-sqlite3` 原生模块 + Next：已配 `serverExternalPackages`，合理；但 `"latest"` 增加原生编译踩坑概率  

---

## 5. 分层细评

### 5.1 数据与导入（强）

- **优点**：事务、去重、标签、备注、FTS 同步写入；adapter 插件化接口干净（`base.ts`）。  
- **弱项**：平台官方格式未实现；无“重新抓取覆盖”；无删除级联后的 FTS 清理工具入口（若删 conversation 依赖 CASCADE，但 UI 层未见删除）。

### 5.2 搜索（中上）

- FTS + LIKE 回退 + snippet 高亮设计合理。  
- 中文分词、排序相关性（目前偏 `imported_at`）、分页（硬 LIMIT 80/100）是下一阶段。

### 5.3 采集（能力强、结构弱）

- **扩展路径**是正确主航道；审计 `readyForReview` / 弱证据判定体现产品思考。  
- 成本：~2600 行无类型 JS、DOM 选择器脆弱、API/DOM 双路径状态机复杂。  
- CDP 路径适合开发调试，对最终用户应进一步降级到“高级折叠区”，避免双主线。

### 5.4 UI

- 首页、搜索、详情、导入：**清晰、够用、本地工具气质正确**。  
- `/capture`：**功能面板过载**，建议拆成“向导（默认）/ 任务 / 审计 / 高级”多页或步骤条。

### 5.5 隐私叙事 vs 实现

- 默认本地、可选 LLM 仅规划：**叙事真实**。  
- 扩展 host_permissions 覆盖四平台 + localhost：**合理且必要**。  
- 需在 UI 更明确提示：采集内容含代码/账号信息时，`data/` 等同敏感目录（README 已写，产品内可再强调）。

---

## 6. 风险清单

| 风险 | 影响 | 可能性 | 缓解 |
|------|------|--------|------|
| 端口暴露导致数据被读写 | 高 | 中（误绑 0.0.0.0） | 绑定 127.0.0.1 + token |
| 平台 DOM/API 改版 | 采集失效 | 高 | 提取器单源 + 健康检查 + 版本审计 |
| `latest` 依赖破坏构建 | 开发中断 | 高 | 钉版本 + 单一包管理器 |
| 超大文件无人敢改 | 迭代变慢 | 已发生 | 拆模块 / TS 化扩展 |
| 无 git 丢工作 | 灾难 | 中 | 立即初始化仓库 |
| 中文搜不准 | 核心价值打折 | 中 | 简易分词或 n-gram / 后续 embedding |

---

## 7. 建议路线图（按优先级）

### 阶段 A — 工程地基（1–2 天）

1. `git init` + 合理 `.gitignore`（已有基础）  
2. 选定 **npm 或 pnpm 其一**，删除另一锁文件；修正 `pnpm-workspace.yaml`  
3. 依赖钉死真实版本（去掉 `"latest"`）  
4. 去掉 UI 硬编码绝对路径  
5. 统一扩展 version / buildId / README  

### 阶段 B — 安全最小集（0.5–1 天）

1. `AIHR_API_TOKEN` + 扩展与 API 双向校验  
2. dev server 明确 host `127.0.0.1`  
3. 危险操作（full capture / chrome open）文档与 UI 警告  

### 阶段 C — 可维护性（3–5 天）

1. 拆分 `CapturePlanner` → hooks + 子组件  
2. 提取器单源：共享选择器描述或生成 content script  
3. 统一 schema 迁移单一入口  
4. 为 import-service / search ftsQuery / adapter 加单元测试  

### 阶段 D — 产品补齐（按用户痛点）

1. ChatGPT/Claude 官方 export adapter  
2. 对话删除 + 重新索引  
3. 导出 Markdown/JSON  
4. 去重策略升级：可选 “更新已存在对话”  
5. 中文搜索增强  

---

## 8. 关键文件索引

| 区域 | 路径 |
|------|------|
| 产品说明 | `README.md`, `extension/README.md` |
| Schema | `src/db/schema.sql`, `src/lib/db.ts` |
| 导入 | `src/services/import-service.ts`, `src/import/adapters/*` |
| 搜索 | `src/services/search-service.ts` |
| 采集审计/任务 | `src/services/capture-audit-service.ts`, `capture-job-service.ts` |
| CDP | `src/services/chrome-cdp-service.ts`, `src/capture/browser-runner.ts` |
| 平台提取（服务端） | `src/capture/platforms.ts` |
| 采集 UI | `src/components/CapturePlanner.tsx` |
| 扩展 | `extension/manifest.json`, `background.js`, `content.js` |
| 类型 | `src/types/conversation.ts` |

---

## 9. 审查结论（给决策用）

**值得继续做。** 问题定义真实，本地闭环已验证，四平台数据已进库。

**不建议**在现有 God 文件上继续无限堆采集特例，而不做：

1. 版本/锁文件/Git 地基  
2. 本地 API 鉴权  
3. 采集代码拆分与提取器去重  

否则会形成“能用但不敢动”的个人脚本型产品。

| 定位 | 说明 |
|------|------|
| **当前最适合** | 作者自用的强力本地工具 / 开源早期项目 |
| **距可靠开源发布** | 还差工程化与测试 |
| **距“问题资产操作系统”** | 还差语义检索、聚类与官方导出 |

---

## 10. 文档说明

- 本文档由 **Grok** 出具，对应 2026-07-11 工作区只读审查。  
- 审查时未修改业务代码；本地 DB 统计与 `tsc` / `eslint` 结果仅反映当时状态。  
- 后续若落地「阶段 A–D」改进，建议在同目录追加变更记录，或更新本文档版本号与日期。  

**文档路径**：`docs/grok-project-assessment.md`
