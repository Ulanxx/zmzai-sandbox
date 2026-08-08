# Sandbox Developer Workbench 与 sandbox_key 设计规格

> 状态：已确认，进入实现计划
>
> 关联仓库：`zmzai-sandbox`、`zmzai-relay`

## 1. 目标

为 Agent 和应用开发者提供一个面向开发的 Sandbox 使用入口。用户登录后可以创建只授权 Sandbox Runner 的 `sandbox_key`，阅读接入文档，并使用 curl、TypeScript 或 Python 调用沙箱。

开发者页面不是运行控制台的装饰区。它要回答三个问题：如何创建凭据、如何提交一次运行、如何读取和处理结果。

## 2. 不在范围内

- 不允许用户输入或保存 OpenAI、Anthropic 或其他供应商 API Key；
- `sandbox_key` 不能直接调用 Relay 的普通模型 API；
- 不开放用户自定义镜像、宿主机路径、Docker socket、特权参数或任意网络规则；
- 不在本次加入定时任务、多人协作、Workspace 持久化、多工具循环或计费页面；
- 不把当前进程内存运行记录伪装成持久化 API。

## 3. 产品结构

新增 `/developers` 开发者工作台，现有 `/` 运行控制台保留，并增加开发文档入口。

开发者工作台包含：

1. 快速开始：登录、创建 key、复制示例、订阅 SSE 四步流程；
2. Sandbox Keys：创建、一次性展示、复制、列表和撤销；
3. API 参考：运行、事件和取消接口，以及 curl/TypeScript/Python 示例；
4. 安全与额度：默认禁网、资源限制、临时环境和 Relay 额度说明。

未登录时不返回 key 列表，只显示登录入口。创建成功的明文 key 只在当前响应和一次性确认区域出现，刷新后不可恢复。

## 4. 系统边界和数据流

```text
开发者浏览器
  -> z.zmzai.cloud /developers
  -> Sandbox /api/keys（转发共享登录 Cookie）
  -> Relay /api/me/sandbox-keys
  -> Relay MongoDB SandboxKey（只存 keyHash）

Agent
  -> Sandbox /api/v1/runs
       Authorization: Bearer zsk_...
  -> Sandbox 使用 RELAY_SANDBOX_SERVICE_SECRET 调 Relay 内部解析接口
  -> Relay 以 sandbox key 绑定的 userId 做模型路由、额度预留、结算和审计
  -> Sandbox Provider 创建 OpenSandbox 临时环境
  -> Sandbox 返回运行状态和 SSE
```

Sandbox 不直接读取 Relay 数据库，也不直接调用 Docker。Sandbox Provider 可以通过私网 OpenSandbox HTTP 控制面创建和销毁临时环境。Relay 仍是用户、模型、余额和 sandbox key 状态的权威服务。

## 5. sandbox_key 模型

Relay 新增独立 `SandboxKey` 集合/模型，避免复用可直接调用 Relay 的 `zrk_` API key：

```text
id: ObjectId
userId: ObjectId
name: string (1..80)
keyHash: string (select:false, unique)
prefix: string (zsk_ 前缀)
status: active | revoked
createdAt: Date
lastUsedAt: Date | null
revokedAt: Date | null
```

生成格式为 `zsk_` 加随机高熵字符串。明文不落库、不写日志、不在列表接口返回。撤销是终态，不能恢复；API 只有撤销语义，记录保留用于审计。Relay 以原子条件更新 `status=active` 完成解析并更新 `lastUsedAt`，撤销完成后，后续解析一定失败。

Relay 的 `Usage` 模型必须迁移为 `callerKind: apikey | session | sandbox_key`，新增可空且有索引的 `sandboxKeyId: ObjectId | null`。历史 usage 记录保持原值并以 `sandboxKeyId=null` 兼容；新 sandbox 调用同时写入 `callerKind=sandbox_key`、`callerId=SandboxKey._id`、`sandboxKeyId=SandboxKey._id`、`apiKeyId=null`。现有 usage 唯一索引 `(callerKind, callerId, requestId)` 保持不变，确保同一个 key 的 Relay 规划请求不会重复计费。

## 6. Relay 接口

登录态接口：

```text
GET    /api/me/sandbox-keys
POST   /api/me/sandbox-keys       { name }
DELETE /api/me/sandbox-keys/:id
```

创建成功返回：

```json
{
  "key": "zsk_<plaintext>",
  "record": {
    "id": "...",
    "prefix": "zsk_ab12cd34",
    "name": "我的 Agent",
    "status": "active"
  }
}
```

服务间接口使用 `Authorization: Bearer <RELAY_SANDBOX_SERVICE_SECRET_CURRENT>`，并接收 `sandboxKey`。至少需要：

```text
POST /api/internal/sandbox/resolve
POST /api/internal/sandbox/chat
```

内部接口仅接受来自 Sandbox 的服务密钥。它们只部署在 Relay 私网地址，例如 `http://127.0.0.1:3002`，不能由 Caddy 暴露到公网。Relay 和 Sandbox 都必须配置 `RELAY_SANDBOX_SERVICE_SECRET_CURRENT`；生产环境缺失时拒绝启动。Relay 可选读取 `RELAY_SANDBOX_SERVICE_SECRET_PREVIOUS`，仅在显式轮换窗口内同时接受 current/previous。Sandbox 只发送 current；窗口结束后先移除 Relay previous，再轮换 Sandbox current。Relay 使用固定时序比较服务密钥，Sandbox 请求超时为 120 秒，日志和 trace 必须脱敏 `Authorization`、`sandboxKey` 和完整 key 值。内部路由不接受 Cookie 或 `zrk_` 作为认证。

Relay 的内部审计记录服务主体 `sandbox`，不得把它当作用户身份。无、错误或已经移除的 previous service secret 一律返回 `401 INTERNAL_SERVICE_UNAUTHORIZED`。生产部署使用回环/私网加 TLS；跨主机时必须使用 mTLS 或等价的网络身份校验。

`resolve` 请求和响应：

```json
{"sandboxKey":"zsk_..."}
```

```json
{"keyId":"sk_123","userId":"user_123","name":"我的 Agent","status":"active"}
```

`chat` 请求只允许携带 `sandboxKey` 和 OpenAI-compatible chat body：

```json
{"sandboxKey":"zsk_...","model":"model-id","messages":[],"tools":[],"requestId":"sandbox_run_..."}
```

`chat` **必须**在同一请求内重新以 `status=active` 解析 `sandboxKey`，只从该记录推导 `userId`、`sandboxKeyId` 和计费主体。它拒绝 `userId`、`keyId`、`allowedModels`、`usageId`、余额或任何调用方指定的授权字段。模型开放目录、余额预留、上游路由、结算和审计全部在 Relay 内部完成，Usage 写入 `callerKind=sandbox_key`、`callerId=sandboxKeyId`、`userId=key.userId`。`resolve` 响应只能用于 Sandbox 的运行归属，不能代替 `chat` 的解析。

公开 `/api/v1/chat/completions` 和 `/api/v1/models` 只调用 `zrk_` resolver 或登录会话 resolver；任何 `zsk_` 请求返回 `401`。

## 7. Sandbox 接口

开发者页面的 key 操作是对 Relay 登录态接口的服务端代理：

```text
GET    /api/keys
POST   /api/keys          { name }
DELETE /api/keys/:id
```

服务间运行接口：

```text
POST /api/v1/runs
GET  /api/v1/runs/:runId
GET  /api/v1/runs/:runId/events
POST /api/v1/runs/:runId/cancel
```

`POST /api/v1/runs` 请求：

```json
{
  "task": "计算 1+1 并输出结果",
  "model": "<Relay 模型 id>"
}
```

请求必须包含 `Idempotency-Key`，格式为 16 到 128 个可打印 ASCII 字符。Sandbox 使用 MongoDB 中的持久化 `SandboxSubmission` 记录，唯一索引为 `(ownerSandboxKeyId, idempotencyKey)`，保存 `requestHash`、`runId`、初始响应、submission 状态与 24 小时 `expiresAt`。相同 key、相同指纹返回已保存的原始 `201` 响应；同一 key、不同指纹返回 `409 IDEMPOTENCY_CONFLICT`；其他 key 不能复用该记录。记录必须在 Relay 规划和 OpenSandbox 创建前以原子 upsert 落库。进程重启时，后台恢复器按存储的 provider sandbox id 和状态恢复监控；无法恢复的 submission 标记为 `failed` 并返回 `SANDBOX_RESTARTED` 终态，不得重新执行或重新计费。这样同一幂等键在 24 小时内可安全重试。

服务端先解析 `sandbox_key`，把不可变的 `ownerSandboxKeyId` 写入运行记录，再调用 Relay 内部 chat；任何认证、模型、额度或 schema 错误都在创建 OpenSandbox 前失败。服务 API 的读、SSE 和取消都必须匹配同一个 `ownerSandboxKeyId`，而非仅匹配 `userId`。同一用户的另一把 key 无权读取、订阅或取消该 run。被撤销 key 的所有服务 API 请求立即返回 `401`；登录控制台仍可按用户身份查看自己的历史运行。

`runId` 格式为 `run_<uuid>`。服务 API 返回的 run 不暴露 `ownerSandboxKeyId`，但持久化记录必须保存它。公开字段为：

```json
{
  "id":"run_<uuid>",
  "task":"计算 1+1 并输出结果",
  "model":"model-id",
  "status":"queued|planning|running|cancellation_requested|succeeded|failed|cancelled",
  "createdAt":"...",
  "startedAt":"...",
  "finishedAt":"...",
  "exitCode":0,
  "error":{"code":"...","message":"..."},
  "artifacts":[]
}
```

允许的状态迁移为 `queued -> planning -> running -> succeeded|failed`，或在 `queued|planning|running` 任一阶段进入 `cancellation_requested -> cancelled|succeeded|failed`。取消请求成功只返回 `202` 与 `{ "run": { "status": "cancellation_requested", ... } }`；详情与终态事件才是最终结果。

现有 Cookie 控制台接口 `/api/runs` 保留，前端页面继续使用它。服务间 API 不应依赖浏览器 Cookie。

## 8. 请求、事件与资源协议

所有 v1 JSON 成功响应使用 `{ "run": ... }`，失败响应统一为：

```json
{"code":"INVALID_BODY","error":"请求体格式不正确"}
```

| 状态 | code | 语义 | 客户端动作 |
| --- | --- | --- | --- |
| 400 | `INVALID_BODY` / `MODEL_INVALID` | task、model、header 或 JSON 不合法 | 修正请求，不重试 |
| 401 | `SANDBOX_KEY_INVALID` | key 缺失、无效或已撤销 | 更换 key，不重试 |
| 402 | Relay 计费 code | 余额不足 | 引导到 `m.zmzai.cloud` |
| 403 | `RUN_FORBIDDEN` | key 不拥有该 run | 停止，不重试 |
| 404 | `RUN_NOT_FOUND` | run 不存在或已过期 | 停止，不重试 |
| 409 | `IDEMPOTENCY_CONFLICT` | 同一幂等键对应不同请求 | 生成新 key 后重试 |
| 413 | `PAYLOAD_TOO_LARGE` | body 或日志超过限制 | 缩小输入 |
| 422 | `AGENT_COMMAND_INVALID` | Relay tool call 不满足 Sandbox schema | 修正任务或稍后重试 |
| 429 | `RATE_LIMITED` | 每 key 或全局配额耗尽 | 按 `Retry-After` 重试 |
| 502 | `RELAY_UPSTREAM_ERROR` | Relay 上游模型调用失败 | 有限重试 |
| 503 | `RELAY_UNAVAILABLE` / `SANDBOX_UNAVAILABLE` | 内部服务不可用 | 指数退避 |

SSE 使用 `text/event-stream`，每个事件有单调递增 `id`/`sequence`：

```text
id: 7
event: stdout
data: {"id":"evt_7","sequence":7,"runId":"run_123","type":"stdout","at":"...","data":{"text":"2\\n"}}

```

事件类型为 `status`、`stdout`、`stderr`、`artifact`、`error`。客户端以 `Last-Event-ID` 重连，Sandbox 重放该序号之后仍在内存保留期内的事件；每 15 秒发送心跳。终态先发送一条 `status` 再关闭连接。preview 中运行和事件最多保留 1 小时，服务重启或保留期结束后查询返回 `404 RUN_NOT_FOUND`，不承诺重放。

preview 资源策略为：最大 body 32 KiB、task 3..2000 字符、单次 Agent code 12 KiB、单次运行 60 秒、stdout+stderr 合计 256 KiB、单个 SSE event 64 KiB、每 key 1 个活动运行、服务器全局 3 个活动运行。超过限制返回以上错误码或将运行标为 failed；任何截断都记录一个 `error` 事件。Relay 服务端还应按 sandboxKeyId 施加每分钟请求限制。

取消是可观察的异步流程。`POST cancel` 返回 `202` 和 `cancellation_requested` 状态；Sandbox 用 AbortController 中断尚未完成的 Relay 规划，并调用 OpenSandbox 删除临时实例来停止在途命令。只有 Provider 确认删除后运行才转为 `cancelled`。已自然结束的 run 返回其原终态；竞态结果通过最终 `status` SSE 事件确定。

## 9. 错误与安全行为

用户文本永远不能直接成为 shell 命令。Relay 返回的 Agent tool call 仍需 Sandbox 本地 schema 校验，语言、代码大小和超时都受固定上限约束。

OpenSandbox 继续只监听回环/私网，默认网络 deny，当前 Docker runtime 为 `runc`。`RELAY_SANDBOX_SERVICE_SECRET` 和 `OPEN_SANDBOX_API_KEY` 只进入服务端环境变量，不进入浏览器、文档示例或日志。

## 10. 页面状态和示例

`/developers` 由客户端读取 `/api/session`，但 key BFF 接口每次都在服务端重新验证共享 Cookie，设置 `Cache-Control: no-store`，并对 mutation 检查同源 `Origin`。创建表单名称限制 1..80 字符，提交期间禁用重复操作。

key 列表响应只返回 `{ keys: [{ id, prefix, name, status, createdAt, lastUsedAt, revokedAt }] }`，按 `createdAt` 倒序，preview 最多返回 100 条。撤销 UI 必须显示 key prefix 和不可恢复确认；失败时保持列表原状态并展示错误。一次性明文窗口在关闭、刷新、返回和重新加载后不再可取回，页面不能把 key 写入 URL、localStorage 或浏览器历史。

快速开始示例必须使用实际 base URL `https://z.zmzai.cloud`、`Authorization: Bearer zsk_...`、`Idempotency-Key`，并覆盖创建 run、读取 `runId`、SSE 重连和取消。curl、TypeScript、Python 三个示例都要处理 `401`、`402`、`429` 与终态。

## 11. 验收标准

### Key 生命周期

- 登录用户可以创建 key，明文只出现一次；
- 列表只返回 prefix 和元数据；
- 撤销后立即不能创建新的运行；
- 用户 A 无法列出、撤销或使用用户 B 的 key；
- 同一用户的不同 key 无法读取或取消对方创建的 run；
- `zsk_` 直接请求公开 Relay chat 或 models 返回 `401`；
- Relay 内部 chat 忽略或拒绝任何调用方传入的 userId/keyId/allowedModels/usageId。

### 运行链路

- Agent 使用 `Authorization: Bearer zsk_...` 创建运行并收到 `runId`；
- 相同 `(sandboxKeyId, Idempotency-Key, request fingerprint)` 不会重复计费或创建容器；
- SSE 返回有序状态、stdout/stderr、心跳和终态，Last-Event-ID 可以在保留期内重放；
- 余额不足、无效模型、无效命令不会创建 OpenSandbox；
- cancel 会实际终止仍在执行的 OpenSandbox，或以终态事件解释竞态；
- 运行详情和取消接口以 `ownerSandboxKeyId` 执行调用方归属校验；
- 现有登录控制台流程继续可用。

### 页面

- 未登录显示登录入口，不泄露 key；
- 创建、复制、一次性展示、撤销均有明确反馈；
- curl、TypeScript、Python 示例与实际接口一致；
- 桌面和移动端无文本溢出、导航可达、按钮有键盘焦点。

## 12. 后续迁移

当运行记录迁移到 PostgreSQL/Redis、Workspace revision 和多工具循环稳定后，再将 `/api/v1/runs` 标记为正式版本并发布 SDK。当前实现必须在文档中标注为开发者预览，不承诺运行记录重启可恢复。
