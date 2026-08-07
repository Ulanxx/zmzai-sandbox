# 接入 ZMZAI Agent

本文说明 Agent 开发者如何接入当前 Sandbox Runner，以及哪些部分应等待稳定服务间 API。

## 当前方式：复用登录会话

当前部署的 `/api/runs` 是控制台型接口，鉴权依赖 `auth.zmzai.cloud` 的登录 Cookie。它适合浏览器和同域 BFF（Backend for Frontend）验证流程，不适合把 Cookie 放进长期运行的 Agent Worker。

### 提交一次运行

```ts
const response = await fetch("https://z.zmzai.cloud/api/runs", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    cookie: sessionCookie,
  },
  body: JSON.stringify({
    task: "计算 1+1 并输出结果",
    model: "<从 GET /api/models 返回的 id>",
  }),
});

if (!response.ok) throw new Error(await response.text());
const { run } = await response.json();
```

要求：

- `task` 为 3 到 2000 个字符；
- `model` 必须来自当前用户的 `GET /api/models`；
- 不要把自然语言任务拼接为 shell 命令；
- 不要从浏览器代码读取或转发 Relay 凭据。

### 订阅运行事件

```ts
const events = new EventSource(`https://z.zmzai.cloud/api/runs/${run.id}/events`);
events.onmessage = (event) => {
  const payload = JSON.parse(event.data) as { run: SandboxRun };
  render(payload.run.events.at(-1));
  if (["succeeded", "failed", "cancelled"].includes(payload.run.status)) events.close();
};
```

服务端当前每约 400ms 检查一次内存中的运行事件。SSE `data` 是 JSON 对象，形状为 `{ "run": ... }`，终态包括 `succeeded`、`failed`、`cancelled`。

### 取消运行

```ts
await fetch(`https://z.zmzai.cloud/api/runs/${run.id}/cancel`, {
  method: "POST",
  headers: { cookie: sessionCookie },
});
```

当前取消会立即把运行标记为 `cancelled`，对已发出的 OpenSandbox 命令不保证立刻中止。不要把它当作强制终止 API。

## Relay 和模型选择

先调用 `GET /api/session` 确认用户，再调用 `GET /api/models` 获取该用户可用模型。模型调用由 Sandbox 服务端转发到 `RELAY_URL/chat/completions`，并带上原始 Cookie。用户余额、模型路由和结算都由 Relay 负责。

## 推荐的 Agent 适配层

在 Agent 中封装一个本地接口，隔离当前控制台 API 与未来稳定 API：

```ts
export interface SandboxRunner {
  submit(input: { task: string; model: string }): Promise<{ runId: string }>;
  events(runId: string, onUpdate: (run: SandboxRun) => void): Promise<void>;
  cancel(runId: string): Promise<void>;
}
```

这样未来切换到服务间 Bearer Token、Workspace revision 和多工具循环时，不需要改 Agent 的业务逻辑。稳定接口草案见 [Agent Runner API 设计](../superpowers/specs/agent-runner-api-design.md)。

## 不要这样接入

- 不要让 Agent 直接访问 `127.0.0.1:8080` 或 Docker socket；
- 不要把 `OPEN_SANDBOX_API_KEY`、Relay key 或用户 Cookie 放进前端；
- 不要假设运行记录会持久化，当前服务重启后内存记录会消失；
- 不要依赖 `provider` 字段来调用 OpenSandbox 的私有 API，Provider 是服务端实现细节。
