# ZMZAI Agent Runner API 设计草案

> 状态：已实现（内部 Agent API）。`a.zmzai.cloud` 的 `exec` 工具通过本文描述的服务间接口执行；消费者侧 `/api/runs` 仍保留为控制台型 Cookie API。
>
> 实际落地的是 `docs/reference/sandbox-agent-internal-api.md` 冻结的契约：`POST /api/internal/agent/runs`（Bearer 服务密钥 + 快照 + 结构化命令 + 限额）、`GET .../runs/:runId`、`GET .../events`（`sandbox.*` 事件，Mongo 重放）、`POST .../cancel`（幂等）。`requestId` 幂等键为 `(taskRunId, requestId)`。

## 目标

为 `zmzai-agent` 提供稳定的服务间接口，让 Agent 可以提交一次受策略约束的执行任务，而不依赖浏览器 Cookie、Next.js 路由或 OpenSandbox SDK。

## 拟议请求

```http
POST /api/v1/runs
Authorization: Bearer <短期 Agent Token>
Content-Type: application/json
Idempotency-Key: <调用方生成>
```

```json
{
  "workspaceRevision": "rev_123",
  "task": "运行测试并生成报告",
  "tools": ["read", "write", "run_code"],
  "policy": "workspace-default",
  "timeoutMs": 60000
}
```

Token 应由 ZMZAI Auth/Agent 服务签发并限定用户、Workspace、工具和额度。调用方不能传入镜像、宿主机挂载、Docker socket 或任意网络规则。

## 拟议响应和事件

```json
{
  "runId": "run_123",
  "status": "queued",
  "createdAt": "2026-08-07T00:00:00.000Z"
}
```

事件沿用 SSE，但事件应改为有序、可重放的 envelope：

```json
{
  "id": "evt_7",
  "runId": "run_123",
  "type": "stdout",
  "sequence": 7,
  "data": {"text":"2\n"}
}
```

## 迁移原则

1. 保留当前 `/api/runs/:runId/events` 的事件语义，先让 Agent 适配层只依赖 `submit/events/cancel` 三个方法。
2. 增加服务间认证后，控制台继续通过自己的 BFF 转发，不让浏览器获得 Agent Token。
3. 运行记录从进程内存迁移到 PostgreSQL/Redis 后，再承诺重启可恢复和幂等提交。
4. Workspace revision、allowlist 产物和多工具循环稳定后，再开放 `read`、`write`、`webfetch` 等工具能力。

## 未决问题

- Token 的签发者和轮换机制；
- 运行日志保留时间、最大事件大小和产物存储；
- 并发配额与单用户公平调度；
- 取消如何映射到 OpenSandbox Execd 的实际进程终止；
- 是否需要把网络访问拆成单独的 Connector Broker。
