# HTTP 与 SSE API 参考

Base URL：`https://z.zmzai.cloud`。当前接口使用浏览器登录会话 Cookie，不接受用户提交的模型 API Key。

## 开发者预览：`sandbox_key`

登录后在 [开发者工作台](https://z.zmzai.cloud/developers) 创建 `zsk_...`。它只能调用 Sandbox Runner，不能直接调用 Relay 的 `/api/v1/chat/completions` 或 `/api/v1/models`。

```bash
curl https://z.zmzai.cloud/api/v1/runs \
  -H "Authorization: Bearer zsk_..." \
  -H "Idempotency-Key: <16-128-character-unique-value>" \
  -H "Content-Type: application/json" \
  -d '{"task":"计算 1+1 并输出结果","model":"<model-id>"}'
```

`GET /api/v1/runs/:runId`、`GET /api/v1/runs/:runId/events` 和 `POST /api/v1/runs/:runId/cancel` 使用同一 `Authorization`。当前开发者预览将运行和幂等记录保存在进程内存中，服务重启后不保证保留；不要把它当作持久化 SDK 承诺。

## `GET /api/session`

读取当前登录用户。

成功 `200`：

```json
{"user":{"id":"user_123","name":"牧之","email":"user@example.com","role":"user"}}
```

未登录 `401`：

```json
{"user":null,"loginUrl":"https://auth.zmzai.cloud/login"}
```

## `GET /api/models`

读取当前用户通过 Relay 可用的模型。Sandbox 服务端会把会话 Cookie 转发给 `m.zmzai.cloud/api/v1/models`。

成功响应由 Relay 返回，至少包含模型的 `id` 和展示信息。未登录为 `401`，Relay 不可用通常为 `503`。不要缓存为全局静态模型列表。

## `POST /api/runs`

创建一次 Agent 运行。

请求：

```json
{"task":"计算 1+1 并输出结果","model":"<model-id>"}
```

限制：`task` 3 到 2000 字符；`model` 必填，且应来自当前用户的模型目录。成功返回 `201` 和 `{ "run": ... }`。未登录为 `401`，参数错误为 `400`，Relay 错误或 OpenSandbox 错误会在运行事件和终态中体现。

运行对象当前形状：

```json
{
  "id":"run_abc12345",
  "userId":"user_123",
  "task":"计算 1+1 并输出结果",
  "model":"model-id",
  "status":"queued|running|succeeded|failed|cancelled",
  "createdAt":"2026-08-07T00:00:00.000Z",
  "startedAt":"2026-08-07T00:00:00.000Z",
  "finishedAt":"2026-08-07T00:00:01.000Z",
  "exitCode":0,
  "provider":"opensandbox",
  "events":[],
  "artifacts":[]
}
```

`userId` 只用于服务端归属校验，客户端不要据此实现授权。

## `GET /api/runs`

返回当前登录用户的运行列表。运行记录目前保存在 Sandbox 进程内存中，服务重启后会消失。

## `GET /api/runs/:runId`

返回属于当前用户的单次运行。不存在或不属于当前用户时返回 `404`。

## `GET /api/runs/:runId/events`

以 `text/event-stream` 返回事件。每条消息格式为：

```text
data: {"run":{"id":"run_abc12345","status":"running","events":[...]}}

```

事件 `kind` 为 `system`、`stdout`、`stderr`、`status` 或 `artifact`。运行进入 `succeeded`、`failed` 或 `cancelled` 后连接关闭。客户端应允许重连并以 `GET /api/runs/:runId` 重新同步状态。

## `POST /api/runs/:runId/cancel`

请求取消当前用户的运行，返回 `{ "run": ... }`。当前实现先更新运行状态，不保证已经发出的 Execd 命令立即停止，见接入指南中的限制。

## `GET /api/provider`

服务端 OpenSandbox 健康检查。配置后成功返回：

```json
{"provider":"opensandbox","configured":true,"healthy":true,"baseUrl":"http://127.0.0.1:8080"}
```

该端点不应公开 OpenSandbox API Key。若控制面不可用则返回 `503`。

## 错误处理

客户端应按 HTTP 状态和运行终态双重处理：`401` 重新登录，`402` 引导用户到 Relay 余额页面，`400` 修正输入，`404` 丢弃失效 run id，`503` 做有限重试并提示服务暂不可用。不要把错误消息当作可执行命令。
