# AI History Recall Chrome Extension

这个扩展用于在你日常使用、已经登录的 Chrome 窗口里采集 AI 对话。

它和应用里的 Chrome CDP 模式不同：CDP 默认会启动一个独立 profile，通常没有你的登录 session；扩展则常驻在你真实打开的 ChatGPT、Gemini、DeepSeek、通义千问页面里。

## 安装

1. 打开 Chrome 的 `chrome://extensions`
2. 开启 `Developer mode`
3. 点击 `Load unpacked`
4. 选择本项目的 `extension/` 目录
5. 重新加载已经打开的 AI 对话页面

## 使用

1. 启动本地应用：`npm run dev`
2. 打开某个 AI 对话详情页
3. 点击扩展图标
4. 点击 `Capture Current Conversation`

如果本地应用启用了 `AIHR_API_TOKEN`，扩展也需要发送同一个 token。可在 `extension/config.js` 中设置：

```js
globalThis.AIHR_LOCAL_API_TOKEN = "change-me";
```

`extension/config.js` 已被 `.gitignore` 忽略，避免把本机 token 提交进仓库。

扩展会把当前页面解析出的消息发送到：

```text
http://localhost:3000/api/extension/capture-page
```

全量发现阶段的审计证据会发送到：

```text
http://localhost:3000/api/extension/discovery-run
```

## 当前能力

- 支持 ChatGPT、Gemini、DeepSeek、通义千问/Qwen
- content script 常驻在支持的 AI 域名
- 只在用户点击按钮后采集当前对话页
- 支持从当前平台历史页启动 `Start Full History Capture`
- 支持启动 `Start All Platforms Capture`，依次打开四个平台历史页发现 URL，再低频分批采集
- Qwen 历史列表没有稳定 `href`，扩展会在后台逐条低频点击可见历史行获取 `/chat/...` URL；每次点击都是短消息，有超时保护，并且发现阶段可停止、可显示进度，不会让全量任务长期卡在 `discovering_qwen`
- 支持 `Stop Full Capture` 请求停止后台任务
- 支持 `Resume Queue` 从已停止/中断的队列位置继续
- 支持 `Clear Status` 清理旧任务状态
- 默认每个对话页之间等待约 5.2-8.4 秒，历史滚动默认间隔 3.2 秒，避免高频请求
- 采集阶段使用 `chrome.storage` 持久化队列，并用 `chrome.alarms` 逐条推进，降低 MV3 background worker 长任务被挂起的影响
- 会把每个平台的 discovery stop reason 写入本地审计表，供 `/api/capture/audit` 检查
- 不接云端，不调用第三方 API

## 全量采集建议

1. 确认你在当前 Chrome 窗口里已经登录 ChatGPT、Gemini、DeepSeek、通义千问/Qwen。
2. 打开任意一个支持的 AI 页面。
3. 点击扩展图标。
4. 保持 `Max conversations` 为 `1000`，或按需要调大。
5. 点击 `Start All Platforms Capture`。
6. 保持 Chrome 和本地应用运行，扩展会在后台打开临时标签页采集，完成后自动关闭临时页。

全量采集是否“平台侧已经全部发现”取决于对应平台页面是否能持续加载历史列表。扩展会在连续多次滚动没有新目标后停止，并在 popup 中显示进度。popup 和 `/capture` 会显示当前平台、discovery phase、已发现 URL 数、扫描标题数和失败数；Qwen 逐行发现时还会显示正在点击的标题。

发现阶段结束后，扩展会把待采集 URL 队列写入 `chrome.storage`。如果 background worker 在采集阶段被 Chrome 暂停，下一次 alarm 或扩展启动时会继续处理队列中的下一条。单条目标如果卡住超过 3 分钟，会自动解锁并重试当前位置；本地导入接口会按 `source_platform + source_url` 去重。

停止任务不会删除队列。需要继续时点击 `Resume Queue`；需要重新开始新任务时点击 `Clear Status` 后再启动。

修改 `manifest.json`、`background.js` 或 `content.js` 后，需要在 `chrome://extensions` 对 AI History Recall Capture 点击一次重新载入。扩展会自动补注入已经打开的本地应用页和平台页，无需刷新 `/capture`。content script 使用独立作用域，可安全重复注入；service worker 会读取本地审计并以 60 秒冷却自动恢复未完成平台。Qwen 优先通过当前登录页面的 session list API 低频分页，使用页面已有设备标识补齐官方公共参数，失败时回退 DOM 滚动；ChatGPT 优先尝试同源会话列表 API，接口不可用或返回空列表时回退 DOM 滚动。单页采集会等待消息渲染，避免页面刚打开时空采集。当前 build 应显示为 `extension v0.1.38 / no-debugger-input-20260711`。

## 从应用页面启动

扩展也会常驻在本地应用页面：

```text
http://localhost:3000/*
```

因此你可以在应用的 `/capture` 页面使用 “Chrome 扩展采集 Agent”：

1. 生成扩展采集计划。
2. 点击“下发给扩展执行”。
3. 应用页面通过 `window.postMessage` 把计划交给 content script。
4. content script 转发给 background worker。
5. background worker 在你的已登录 Chrome 中完成发现和采集。

这个链路用于把应用侧的大模型/规则规划能力接入扩展采集执行能力。

`/capture` 页面同样提供停止、继续队列、清理状态按钮。

## 后续方向

- 增加更强的平台专用历史列表选择器
- 增加更细粒度的平台限速预设和失败重试策略
