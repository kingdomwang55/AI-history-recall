# AI History Recall

AI History Recall 是一个本地优先、隐私友好的 AI 历史对话召回工具。

产品定位：

> AI 工具越用越多，真正的问题不是模型不够强，而是人的问题资产正在失忆。AI History Recall 帮你把散落在不同 AI 平台里的历史对话重新召回，让曾经解决过的问题、写过的方案、踩过的坑，不再沉没在各个平台的历史列表里。

第一版不是聊天工具，也不接云端。它先做一个本地闭环：导入或采集历史对话，标准化存入 SQLite，用 FTS5 + 本地语义索引混合搜索，再进入详情页做复制、标签、备注和导出。

## 技术栈

- TypeScript
- Next.js App Router
- React
- Tailwind CSS
- SQLite
- SQLite FTS5
- 本地语义索引，可选 Ollama / OpenAI-compatible embedding
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

`npm run dev` 和 `npm start` 默认只绑定 `127.0.0.1`，不会监听局域网地址。

### 桌面端端口

桌面版使用两个仅绑定本机回环地址的端口：

- `127.0.0.1:32145` 是固定的桌面守护进程端口。Chrome 扩展配对、WebSocket 在线状态、采集命令和数据写入都通过此端口完成。
- 桌面 UI 每次启动会申请一个随机空闲端口，只供 Tauri WebView 使用。该端口无需配置，也不应被脚本或扩展依赖。
- `127.0.0.1:3000` 仅是 `npm run dev` 浏览器开发模式的回退端口，不是桌面版后台端口。

所有端口都只监听 `127.0.0.1`，并使用桌面应用生成的本地 token 鉴权。若桌面版无法启动或扩展无法连接，先检查固定端口是否被占用：

```bash
lsof -nP -iTCP:32145 -sTCP:LISTEN  # macOS
netstat -ano | findstr :32145      # Windows
```

正常情况下监听进程应为随桌面应用打包的 `aihr-node`。不要把 `32145` 转发到局域网或公网。

如果要启用本地 API shared token，只需要在服务端设置 `AIHR_API_TOKEN`：

```bash
AIHR_API_TOKEN="change-me" npm run dev
```

浏览器 UI 不再读取公开的 `NEXT_PUBLIC_*` token；同源本地页面可以直接调用本机接口。Chrome 扩展可通过未跟踪的 `extension/config.js` 配置同一个 token；仓库提供了 `extension/config.example.js` 作为模板。跨站来源、非本机来源和不匹配 token 的请求会被拒绝。

### 语义搜索与本地 embedding

默认情况下，AI History Recall 使用内置的离线语义索引，不启用、不启动、也不调用任何 embedding 小模型；不需要下载模型，也不会把对话内容发出本机。只有显式设置 `AIHR_EMBEDDING_PROVIDER=ollama` 或 `AIHR_EMBEDDING_PROVIDER=openai-compatible` 时，才会调用外部或本机 embedding 服务。若要提升语义召回质量，可以配置本机 Ollama embedding 模型：

```bash
ollama pull embeddinggemma

AIHR_EMBEDDING_PROVIDER=ollama \
AIHR_EMBEDDING_MODEL=embeddinggemma \
AIHR_EMBEDDING_BASE_URL=http://127.0.0.1:11434 \
npm run dev
```

首次切换 embedding 模型后，需要在对话详情页点击“重建搜索索引”，或调用：

```bash
curl -X POST http://127.0.0.1:3000/api/search/reindex
```

也支持 OpenAI-compatible embedding 服务：

```bash
AIHR_EMBEDDING_PROVIDER=openai-compatible \
AIHR_EMBEDDING_MODEL=your-embedding-model \
AIHR_EMBEDDING_BASE_URL=http://127.0.0.1:8000 \
AIHR_EMBEDDING_API_KEY=optional-token \
npm run dev
```

推荐优先用专门的 embedding 模型，例如 `embeddinggemma`、`qwen3-embedding`、`nomic-embed-text`、`mxbai-embed-large` 或 `bge-m3`。普通生成模型例如 `gemma4` 主要用于文本/多模态生成，不是 embedding 模型；除非运行时明确提供 embedding 向量接口，否则不建议拿它做语义搜索索引。

## 桌面版安装与发布

桌面版基于 Tauri 2，安装后不需要另行安装 Node.js。首次启动会打开三步设置向导；之后关闭主窗口会销毁 WebView 和 UI 服务，只保留托盘与轻量本地守护进程。托盘菜单可以重新打开窗口、暂停后台采集或彻底退出。启用“登录时启动”后，应用会像 Clash Verge 一样只在托盘后台启动，不主动弹出窗口。

### 开发安装包

构建机需要 Node.js 24、Rust stable 和对应平台的原生打包工具。macOS 生成 DMG：

```bash
npm ci
AIHR_DESKTOP_NODE_BINARY="$(node -p 'process.execPath')" npm run desktop:prepare
npx tauri build --bundles dmg
```

Windows 请在原生 Windows 环境中运行：

```powershell
npm ci
$env:AIHR_DESKTOP_NODE_BINARY = node -p "process.execPath"
npm run desktop:prepare
npx tauri build --bundles nsis,msi
```

产物分别位于 `src-tauri/target/release/bundle/dmg/`、`src-tauri/target/release/bundle/nsis/` 和 `src-tauri/target/release/bundle/msi/`。`.github/workflows/desktop-build.yml` 会在原生 macOS 和 Windows runner 上完成测试、构建并上传保留 14 天的开发安装包；可手动触发，也会在版本 tag 和相关 pull request 上运行。

当前开发安装包没有代码签名。macOS 请先把 DMG 中的应用拖入 `Applications` 再启动；若被 Gatekeeper 拦截，请在 Finder 中右键应用并选择“打开”，或在“系统设置 -> 隐私与安全性”中确认，不要全局关闭 Gatekeeper。Windows SmartScreen 出现警告时，只应对自己构建或来源可信的产物选择“更多信息 -> 仍要运行”。正式分发所需的代码签名、Apple notarization、Windows 签名证书和远程自动更新服务不在当前范围内。

### 首次使用与数据

1. 在设置向导中确认数据目录。macOS 默认位于 `~/Library/Application Support/com.aihistoryrecall.desktop/`，Windows 默认位于 `%APPDATA%\com.aihistoryrecall.desktop\`。
2. 在扩展配对步骤点击“打开扩展目录”，或按页面显示的绝对路径，在 `chrome://extensions` 中选择“加载已解压的扩展程序”。安装版应使用应用资源目录中的扩展，不要继续使用旧源码或旧 `target/debug` 副本。
3. 扩展显示 `extension v0.1.44 / desktop-websocket-20260717` 后回到应用检查连接。固定守护端口仍是 `127.0.0.1:32145`。
4. 设置页始终可以从左侧导航的“设置”进入，“重新打开设置向导”可再次进入扩展配对步骤。

设置页提供 SQLite 备份下载与恢复；恢复前会校验数据库并保留回滚副本。升级、迁移或批量导入前建议先下载备份。默认不开启外部 embedding 和生成模型，摘要、标签与相似对话先使用内置本地规则；只有用户显式配置并启用模型后才会访问相应服务。

发布模式下的五分钟纯托盘实测预算为：平均 CPU `<0.5%`、组合 RSS `<=120 MB`、数据库调度唤醒 `<=5`、未配置外连 `0`。D5 实测为平均 CPU `0.253%`、峰值 RSS `105.8 MB`、唤醒 `5`、外连 `0`。复测命令：

```bash
npm run desktop:measure-idle -- --duration-ms 300000 --interval-ms 5000
```

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

Chrome 可执行文件和 profile 目录只能通过本机环境变量配置，接口不会接受调用方传入的 `chromePath` 或 `userDataDir`：

```bash
CHROME_PATH="/path/to/Google Chrome" \
CHROME_USER_DATA_DIR="$HOME/.ai-history-recall-chrome" \
npm run dev
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

页面顶部集中显示四个平台是否已有页面打开、最近同步时间、最近新增对话/消息数和错误。Qwen 优先使用页面自身的 session list 接口，ChatGPT 优先使用登录页面的同源会话列表接口，接口不可用时回退低频侧栏发现。DeepSeek 的置顶分组会单独去重，不占“连续已知”阈值，避免遮住后面的“昨天”和“7 天内”新记录。桌面版通过 `127.0.0.1:32145` 的本地 WebSocket 在 Tauri App 与 Chrome 扩展之间转发命令，不依赖扩展向 Tauri WebView 注入脚本。修改未打包扩展代码后，在 `chrome://extensions` 对 AI History Recall Capture 点击一次重新载入。当前版本应显示 `extension v0.1.44 / desktop-websocket-20260717`。

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
- 按项目聚类和问题资产分类
- 通义千问官方导出格式解析
- 平台页面结构变化后的 adapter/selector 维护与诊断工具
- 对历史消息编辑、重新生成答案和分支对话做冲突感知合并；当前无稳定重叠时会保守跳过，避免污染原记录
- 在 UI 中开放每个平台独立的同步周期与限速预设；当前只提供统一的后台暂停/恢复
- 语义搜索质量基准集与模型效果对比
- 正式代码签名、公证和可回滚自动更新

## 常用命令

```bash
npm run dev
npm run build
npm run start
npm run db:reset
npm run desktop:prepare
npm run desktop:build
npm run desktop:measure-idle
```

`npm run desktop:build` 会先重新生成 UI 与 sidecar，避免把旧资源装进新安装包；需要限制安装包类型时可直接执行上文的 `npx tauri build --bundles ...`。

## License

Apache License 2.0. See [LICENSE](./LICENSE).
