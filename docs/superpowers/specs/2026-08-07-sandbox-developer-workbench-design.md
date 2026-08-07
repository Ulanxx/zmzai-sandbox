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

Sandbox 不直接读取 Relay 数据库，不直接调用 Docker/OpenSandbox 控制面。Relay 仍是用户、模型、余额和 sandbox key 状态的权威服务。

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
```

生成格式为 `zsk_` 加随机高熵字符串。明文不落库、不写日志、不在列表接口返回。撤销是终态，不能恢复；删除和撤销都要保留审计所需的记录。

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

服务间接口使用 `Authorization: Bearer <RELAY_SANDBOX_SERVICE_SECRET>`，并接收 `sandboxKey`。至少需要：

```text
POST /api/internal/sandbox/resolve
POST /api/internal/sandbox/chat
```

内部接口仅接受来自 Sandbox 的服务密钥。`resolve` 返回 key 绑定的 `userId`、key id、名称和状态；`chat` 在 Relay 内部完成模型 allowlist、余额预留、上游路由、结算和使用审计。Relay 的公开 `/api/v1/chat/completions` 和 `/api/v1/models` 不接受 `zsk_`。

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

服务端先解析 `sandbox_key`，再调用 Relay 内部 chat；任何认证、模型、额度或 schema 错误都在创建 OpenSandbox 前失败。

现有 Cookie 控制台接口 `/api/runs` 保留，前端页面继续使用它。服务间 API 不应依赖浏览器 Cookie。

## 8. 错误与安全行为

```text
401  key 不存在、已撤销或登录会话过期
403  运行不属于当前调用方
402  Relay 余额不足，客户端引导到 m.zmzai.cloud
429  key 或服务达到速率限制
503  Relay/OpenSandbox 暂不可用
```

用户文本永远不能直接成为 shell 命令。Relay 返回的 Agent tool call 仍需 Sandbox 本地 schema 校验，语言、代码大小和超时都受固定上限约束。

OpenSandbox 继续只监听回环/私网，默认网络 deny，当前 Docker runtime 为 `runc`。`RELAY_SANDBOX_SERVICE_SECRET` 和 `OPEN_SANDBOX_API_KEY` 只进入服务端环境变量，不进入浏览器、文档示例或日志。

## 9. 验收标准

### Key 生命周期

- 登录用户可以创建 key，明文只出现一次；
- 列表只返回 prefix 和元数据；
- 撤销后立即不能创建新的运行；
- 用户 A 无法列出、撤销或使用用户 B 的 key；
- `zsk_` 直接请求公开 Relay chat 返回未授权。

### 运行链路

- Agent 使用 `Authorization: Bearer zsk_...` 创建运行并收到 `runId`；
- SSE 返回有序状态、stdout/stderr 和终态；
- 余额不足、无效模型、无效命令不会创建 OpenSandbox；
- 运行详情和取消接口执行调用方归属校验；
- 现有登录控制台流程继续可用。

### 页面

- 未登录显示登录入口，不泄露 key；
- 创建、复制、一次性展示、撤销均有明确反馈；
- curl、TypeScript、Python 示例与实际接口一致；
- 桌面和移动端无文本溢出、导航可达、按钮有键盘焦点。

## 10. 后续迁移

当运行记录迁移到 PostgreSQL/Redis、Workspace revision 和多工具循环稳定后，再将 `/api/v1/runs` 标记为正式版本并发布 SDK。当前实现必须在文档中标注为开发者预览，不承诺运行记录重启可恢复。
