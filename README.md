# AI History Recall

AI History Recall 是一个本地优先、隐私友好的 AI 历史对话召回工具。

产品定位：

> AI 工具越用越多，真正的问题不是模型不够强，而是人的问题资产正在失忆。AI History Recall 帮你把散落在不同 AI 平台里的历史对话重新召回，让曾经解决过的问题、写过的方案、踩过的坑，不再沉没在各个平台的历史列表里。

第一版不是聊天工具，也不接云端。它只做一个 MVP 闭环：导入本地历史对话文件，标准化存入 SQLite，用 FTS5 全文搜索，再进入详情页做复制、标签和备注。

## 技术栈

- TypeScript
- Next.js App Router
- React
- Tailwind CSS
- SQLite
- SQLite FTS5
- better-sqlite3
- playwright-core，用于连接本机 Chrome 做可控浏览器采集
- 本地文件导入
- 本地存储，不上传服务器

## 启动

```bash
npm install
npm run dev
```

打开：

```text
http://localhost:3000
```

数据库默认写入：

```text
data/ai-history-recall.sqlite
```

也可以用环境变量指定数据库位置：

```bash
AIHR_DB_PATH=/your/path/ai-history-recall.sqlite npm run dev
```

如果要启用本地 API shared token，服务端和浏览器 UI 需要使用同一个值：

```bash
AIHR_API_TOKEN="change-me" \
AIHR_LOCAL_API_TOKEN="change-me" \
npm run dev
```

启用后，所有 `/api/*` 接口都会校验 `X-AIHR-API-Token` 或 `Authorization: Bearer ...`。Chrome 扩展可通过未跟踪的 `extension/config.js` 配置同一个 token；仓库提供了 `extension/config.example.js` 作为模板。

## 使用

1. 打开首页查看本地数据概览。
2. 进入 `/import` 上传 `txt`、`md`、`json` 或 `html` 文件。
3. 进入 `/capture` 查看后台同步状态，或点击“同步新增”立即检查四个平台。
4. 进入 `/search` 输入关键词搜索。
5. 点击搜索结果进入对话详情。
6. 在详情页复制单条消息或整段对话。
7. 给对话添加 tags 和 note，刷新后仍会保存在 SQLite。

示例文件在 `examples/`：

- `examples/sample-conversation.md`
- `examples/sample-conversation.txt`
- `examples/sample-conversations.json`

## 当前 adapter

已实现：

- Generic JSON Adapter
- Generic Markdown Adapter
- Generic TXT Adapter
- Generic HTML Adapter

已预留结构：

- ChatGPT Adapter
- Claude Adapter
- DeepSeek Adapter
- 通义千问 Adapter

后续可以把不同平台的官方导出格式适配逻辑放到 `src/import/adapters/` 中。

## 浏览器采集

项目内置了浏览器采集能力，目标是让 AI History Recall 自己具备“打开 AI 平台历史页、低频滚动、提取消息、写入 SQLite”的能力，而不是只依赖人工导入文件。

已内置平台提取器：

- ChatGPT：读取 `data-message-author-role`
- Gemini：读取 `user-query` / `message-content`
- DeepSeek：读取 `.ds-message`
- 通义千问/Qwen：读取 `.chat-round`，并带 DOM fallback

### 1. 推荐路径：常驻 Chrome 扩展

进入 `/capture` 后，普通使用只需要看页面顶部的增量同步区。第一次使用时按页面提示加载 `extension/` 目录；之后扩展会在低频 alarm 中检查新增记录，也会在你打开具体 AI 对话后延迟保存当前快照。需要立即检查时，点击一次“同步新增”即可。

这个方式会使用你平时浏览器里的登录 session，不需要为了采集重新打开一个没有登录态的 Chrome。

### 2. 高级备用：Chrome DevTools

`/capture` 的高级调试区仍保留 “Chrome CDP” 能力。应用可以尝试使用独立 profile 启动 Chrome：

```text
~/.ai-history-recall-chrome
```

注意：独立 profile 不包含你日常 Chrome 里的登录 session。如果你已经在平时使用的 Chrome 窗口里登录了 ChatGPT、Gemini、DeepSeek 或通义千问，推荐使用上面的常驻扩展方案。

有两种方式：

1. 关闭日常 Chrome，然后用远程调试端口和你的日常 profile 重新启动。
2. 加载 `extension/` 目录里的 Chrome 扩展，让 content script 常驻在当前已登录窗口里采集。

如果你的 Chrome 不在默认路径，可以设置：

```bash
CHROME_PATH="/path/to/Google Chrome" npm run dev
```

也可以手动启动：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.ai-history-recall-chrome"
```

### 当前已登录窗口采集

如果不想重启日常 Chrome，可以加载本项目的扩展。这个扩展会把 content script 常驻在 ChatGPT、Gemini、DeepSeek、通义千问/Qwen 的页面里，因此能使用你当前浏览器窗口已有的登录 session。

1. 打开 Chrome 的 `chrome://extensions`
2. 开启 Developer mode
3. 点击 Load unpacked
4. 选择本项目的 `extension/` 目录
5. 回到 `/capture`，等待页面显示“扩展已连接”

扩展会把当前页面解析出的消息发送到：

```text
http://localhost:3000/api/extension/capture-page
```

这个模式使用你当前浏览器窗口的登录 session。扩展弹窗里也保留三类手动动作，主要用于调试：

- `Capture Current Conversation`：采集当前对话页。
- `Start Full History Capture`：从当前平台历史页低频滚动发现对话 URL，再逐条打开采集。
- `Start All Platforms Capture`：依次打开 ChatGPT、Gemini、DeepSeek、通义千问/Qwen 历史页发现 URL，再按约 5.2-8.4 秒的页面间隔分批采集。Qwen 左侧历史列表不直接暴露 `href`，扩展会用专门的短步骤流程逐条低频点击可见历史行获取 `/chat/...` URL，避免一个长请求卡死整个任务。

扩展会把采集结果写入本地接口 `/api/extension/capture-page`。首次见到的 `source_platform + source_url` 创建新会话；已存在的会话会比较消息序列，只追加未见过的尾部消息并同步更新 FTS5，原有 tags、remark 和 note 不会被覆盖。全量发现与增量发现分别记录，增量运行不会覆盖此前“全量已扫完”的审计证据。

增量同步默认每 6 小时检查一次，每个平台最多扫描最近 50 条；连续遇到 10 条已知 URL 时提前停止。失败后至少退避 15 分钟。用户打开具体对话 URL 时，扩展会随机延迟 20–45 秒保存快照；同一页面继续产生消息时会在页面安静 45 秒后预约补抓，同一 URL 10 分钟内不重复且冷却期内的更新不会丢失。所有队列和设置都在 `chrome.storage`，所有对话和同步状态都在本地 SQLite；不上传 cookie，不接云端，也不使用 `chrome.debugger` 或系统级输入模拟。

扩展说明见：

```text
extension/README.md
```

### 从应用页面驱动扩展

`/capture` 页面顶部现在是“增量同步”：

普通使用只需要点击页面顶部的“同步新增”。它会自动执行：

1. 检查 Chrome 扩展和可恢复队列。
2. 从四个平台最新历史记录开始发现。
3. 每个平台最多检查 50 条，连续 10 条已知即停止。
4. 对新增 URL 创建会话，对已有 URL 合并新消息。
5. 更新 SQLite、FTS5 和每个平台最近同步状态。

页面顶部集中显示四个平台是否已有页面打开、最近同步时间、最近新增对话/消息数和错误。Qwen 优先使用页面自身的 session list 接口，ChatGPT 优先使用登录页面的同源会话列表接口，接口不可用时回退低频侧栏发现。DeepSeek 的置顶分组会单独去重，不占“连续已知”阈值，避免遮住后面的“昨天”和“7 天内”新记录。修改未打包扩展代码后，只需在 `chrome://extensions` 对 AI History Recall Capture 点击一次重新载入；扩展会自动补注入已打开页面，无需刷新 `/capture`。当前版本应显示 `extension v0.1.42 / deepseek-pinned-groups-20260715`。

审计区会显示每个平台的导入数、索引数、最近 discovery stop reason、扫描标题数、失败数和“耗尽证据”。当 `readyForReview` 为真时，表示本地数据、索引、队列和最近全量发现证据都已就绪，可以再人工抽查平台侧历史列表；如果最近发现是 `targets=0/scanned=0`，会被标记为弱证据，不会直接通过验收。

对应接口：

```bash
curl -X POST http://localhost:3000/api/extension/plan \
  -H 'content-type: application/json' \
  -d '{
    "instruction": "通过我当前已登录的 Chrome 扩展，低频抓取 ChatGPT、Gemini、DeepSeek、通义千问的全部历史对话"
  }'
```

如果配置了 `LLM_BASE_URL` 和 `LLM_API_KEY`，该接口会让 OpenAI-compatible 模型生成扩展采集计划；未配置时使用本地规则生成同样的安全低频计划。

然后启动应用：

```bash
CHROME_CDP_URL=http://127.0.0.1:9222 npm run dev
```

进入：

```text
http://localhost:3000/capture
```

然后点击“打开四个平台”，应用会在受控 Chrome 中打开：

- ChatGPT
- Gemini
- DeepSeek
- 通义千问/Qwen

请先在这些页面里完成登录，再创建可恢复批量任务。

对应 API：

```bash
curl -X POST http://localhost:3000/api/capture/chrome/open \
  -H 'content-type: application/json' \
  -d '{"platforms":["chatgpt","gemini","deepseek","qwen"]}'
```

创建任务前可以点击“预检四个平台”，确认四个平台标签页是否已经打开、是否看起来停在登录页：

```bash
curl -X POST http://localhost:3000/api/capture/chrome/preflight \
  -H 'content-type: application/json' \
  -d '{"platforms":["chatgpt","gemini","deepseek","qwen"]}'
```

也可以用全量采集向导串起这些动作。准备模式会启动 Chrome、打开四个平台并预检，但不会直接抓取：

```bash
curl -X POST http://localhost:3000/api/capture/full \
  -H 'content-type: application/json' \
  -d '{
    "launchChrome": true,
    "openPlatforms": true,
    "preflight": true,
    "createJob": false
  }'
```

确认四个平台已登录后，可以让向导创建可恢复任务，或继续低频执行若干批次：

```bash
curl -X POST http://localhost:3000/api/capture/full \
  -H 'content-type: application/json' \
  -d '{
    "instruction": "发现 ChatGPT、Gemini、DeepSeek、通义千问全部历史对话，创建可恢复采集任务。",
    "preflight": true,
    "createJob": true,
    "runUntilIdle": false
  }'
```

### 2. 可恢复批量任务

全量抓取多个平台历史时，更推荐使用可恢复任务。它会先把发现到的历史对话 URL 写入 SQLite 队列，再按批次低频抓取。中断后可以继续执行下一批。

当自然语言里包含“全部 / 所有 / 全量”时，本地规则会把每个平台发现上限提升到 `1000` 条、最多滚动 `200` 次，并在连续多次滚动没有发现新目标时自动停止。

创建任务：

```bash
curl -X POST http://localhost:3000/api/capture/jobs \
  -H 'content-type: application/json' \
  -d '{
    "instruction": "发现 ChatGPT、Gemini、DeepSeek、通义千问全部历史对话，创建可恢复采集任务。"
  }'
```

查看任务列表：

```bash
curl http://localhost:3000/api/capture/jobs
```

执行某个任务的下一批：

```bash
curl -X POST http://localhost:3000/api/capture/jobs/<job-id> \
  -H 'content-type: application/json' \
  -d '{"batchSize": 5, "maxAttempts": 3}'
```

连续低频执行，直到没有可执行目标或达到最大批次数：

```bash
curl -X POST http://localhost:3000/api/capture/jobs/<job-id> \
  -H 'content-type: application/json' \
  -d '{
    "runUntilIdle": true,
    "batchSize": 5,
    "maxBatches": 20,
    "batchDelayMs": 12000,
    "maxAttempts": 3
  }'
```

`batchSize` 建议保持在 `3-8`，`batchDelayMs` 建议不低于 `12000`。失败目标会保留在任务里，但达到 `maxAttempts` 后不会继续自动重试，避免坏链接导致任务空转。降低批次大小、重新登录平台或调整平台页面状态后，可以提高 `maxAttempts` 再继续。

抓取后可以用审计接口查看四个平台的导入、索引和任务目标状态：

```bash
curl http://localhost:3000/api/capture/audit
```

`locallyConsistent: true` 表示四个平台都有导入记录、消息已写入索引、当前没有 pending/running/failed 目标，并且最近一次全量发现以 `no_new_targets` 停止且没有达到上限。`complete` 仍不会仅凭本地数据置为 true，因为它不能单独替代你对平台侧历史列表的人工确认。

### 3. Agent 一键执行

`/api/capture/agent` 会把自然语言请求转换成动作计划，并按顺序执行：

1. 发现平台历史列表
2. 生成待抓取 URL
3. 打开对话页低频滚动
4. 提取消息
5. 写入本地 SQLite 和 FTS5

默认没有配置大模型时，会使用本地规则识别平台和 URL。配置 `LLM_BASE_URL`、`LLM_API_KEY` 后，会让 OpenAI-compatible 模型生成动作计划，但浏览器控制和数据入库仍然只在本机完成。

只生成计划，不执行：

```bash
curl -X POST http://localhost:3000/api/capture/agent \
  -H 'content-type: application/json' \
  -d '{
    "instruction": "发现并导入通义千问最近 10 条历史对话，低频滚动，避免触发限流。",
    "dryRun": true
  }'
```

执行完整链路：

```bash
curl -X POST http://localhost:3000/api/capture/agent \
  -H 'content-type: application/json' \
  -d '{
    "instruction": "发现并导入 ChatGPT、Gemini、DeepSeek、通义千问最近 20 条历史对话。"
  }'
```

Agent 为了安全和稳定，会限制单次动作数和目标数；需要更多历史时，优先使用可恢复批量任务。

### 4. 生成抓取计划

`/api/capture/plan` 会把自然语言请求转换成 CapturePlan。默认只用本地规则解析 URL，不调用外部服务。

```bash
curl -X POST http://localhost:3000/api/capture/plan \
  -H 'content-type: application/json' \
  -d '{"instruction":"抓取 https://chatgpt.com/c/... 和 https://www.qianwen.com/chat/..."}'
```

如需大模型驱动计划生成，配置 OpenAI-compatible 环境变量：

```bash
LLM_BASE_URL=https://api.openai.com/v1 \
LLM_API_KEY=... \
LLM_MODEL=gpt-4.1-mini \
CHROME_CDP_URL=http://127.0.0.1:9222 \
npm run dev
```

模型只负责生成计划 JSON；真正的浏览器控制和数据入库仍在本机完成。

### 5. 自动发现历史列表

`/api/capture/discover` 会进入指定平台首页或历史页，低频滚动历史列表并生成 CapturePlan。

```bash
curl -X POST http://localhost:3000/api/capture/discover \
  -H 'content-type: application/json' \
  -d '{
    "platform": "qwen",
    "maxItems": 20,
    "maxScrolls": 4
  }'
```

当前发现策略：

- ChatGPT / Gemini / DeepSeek：滚动侧边栏并收集历史对话链接
- 通义千问/Qwen：真实滚轮滚动左侧历史列表，点击可见行获取 `/chat/...` URL
- 发现阶段会边收集边去重；连续几次滚动没有新增目标时会停止，避免空滚动

### 6. 执行抓取并导入

```bash
curl -X POST http://localhost:3000/api/capture/browser \
  -H 'content-type: application/json' \
  -d '{
    "targets": [
      {
        "platform": "qwen",
        "url": "https://www.qianwen.com/chat/..."
      }
    ],
    "rateLimit": {
      "pageDelayMs": 4300,
      "pageJitterMs": 2800,
      "afterScrollDelayMs": 1600
    },
    "importAfterCapture": true
  }'
```

抓取结果会复用现有导入服务，按 `source_platform + source_url` 去重，并写入 FTS5 搜索索引。

## 数据库结构

初始化 SQL 在：

```text
src/db/schema.sql
```

包含：

- `conversations`
- `messages`
- `tags`
- `conversation_tags`
- `notes`
- `search_index`，使用 SQLite FTS5
- `capture_jobs`
- `capture_targets`

数据库会在服务端首次访问时自动初始化。

## 项目结构

```text
src/
  app/
    api/
    capture/
    conversations/
    import/
    search/
  components/
  capture/
  db/
  import/
    adapters/
  lib/
  services/
  types/
examples/
data/
```

## 隐私说明

第一版所有数据只保存在本地 SQLite 文件中：

- 不需要登录
- 不上传云端
- 默认不调用第三方 AI API
- 不做云同步

只有在你显式配置 `LLM_BASE_URL` 和 `LLM_API_KEY` 时，`/api/capture/plan`、`/api/capture/agent` 和 `/api/extension/plan` 才会调用大模型生成抓取计划或动作计划。

如果你导入的对话里包含账号、代码、工作资料或客户信息，请把 `data/` 目录当作敏感数据目录管理。

## 后续 TODO

- 支持 ChatGPT 官方导出 `conversations.json`
- 支持 Claude 官方导出
- 支持 DeepSeek 历史记录导出
- 更好的中文分词搜索
- 本地 embedding 语义搜索
- 自动总结对话
- 按项目聚类和问题资产分类
- 通义千问官方导出格式解析
- 平台页面结构变化后的 adapter/selector 维护与诊断工具
- 对历史消息编辑、重新生成答案和分支对话做冲突感知合并；当前无稳定重叠时会保守跳过，避免污染原记录
- 在 UI 中开放每个平台独立的同步周期与限速预设；当前只提供统一的后台暂停/恢复

## 常用命令

```bash
npm run dev
npm run build
npm run start
npm run db:reset
```
