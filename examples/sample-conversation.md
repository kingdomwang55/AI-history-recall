# n8n Webhook 报错排查

User:
我在 n8n 里配置 Webhook，测试时返回 404，应该从哪里排查？

Assistant:
先确认你访问的是 test URL 还是 production URL。n8n 的测试 Webhook 需要工作流处于监听状态，点击 Execute workflow 后再请求 test URL。

User:
如果 production URL 也不通呢？

Assistant:
检查工作流是否已 active，反向代理是否转发了 `/webhook/` 路径，以及 `WEBHOOK_URL` 环境变量是否和外部访问域名一致。
