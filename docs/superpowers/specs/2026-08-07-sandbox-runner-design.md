# ZMZAI Sandbox Runner v0 设计规格

> 状态：已确认，第一阶段实现控制台和 Provider 边界
>
> 关联仓库：`zmzai-agent`、`zmzai-relay`

## 1. 目标

`zmzai-sandbox` 是 ZMZAI Agent 的代码执行层。它接收一次已授权的执行请求，在临时隔离环境中运行命令，返回状态、实时日志、退出码和产物，并在结束后清理执行环境。

它不是 Agent Orchestrator，也不负责 Workspace 正式写入、模型调用或用户审批。

## 2. v0 范围

### 支持

- 单服务器部署。
- 单用户、最大一个活动 Sandbox。
- 临时 Sandbox，执行完成后销毁。
- Node.js + TypeScript 初始执行镜像。
- 运行状态、实时 SSE 事件流、取消任务。
- Workspace revision 快照作为输入。
- 产物回传和资源用量记录的接口位置。
- OpenSandbox Provider 抽象。

### 暂不支持

- Kubernetes 调度。
- 持久化 Sandbox 和共享工作目录。
- 浏览器、桌面和 VNC 环境。
- 用户自定义镜像。
- 公网访问 Sandbox API。
- 默认联网执行。
- 多租户级别的恶意代码隔离保证。

## 3. 部署形态

```text
香港服务器
  ├── Caddy / Next.js 控制台
  ├── zmzai-agent API
  ├── zmzai-relay
  └── zmzai-sandbox 控制 API
          └── OpenSandbox Server
                  └── Docker runtime
                          └── 临时 Node.js Sandbox
```

OpenSandbox 只监听内网或 `127.0.0.1`。浏览器和模型不能直接访问 OpenSandbox API。

`zmzai-agent` 只调用 `zmzai-sandbox` 的稳定接口，不直接依赖 Docker、OpenSandbox SDK 或具体 runtime。

## 4. Provider 边界

```text
SandboxProvider
  ├── DemoProvider
  ├── OpenSandboxProvider
  └── LocalDockerProvider
```

最小接口：

```text
createRun(input, policy) -> runId
getRun(runId) -> status
subscribeLogs(runId) -> event stream
cancelRun(runId) -> acknowledgement
collectArtifacts(runId) -> artifact list
```

Provider 的切换不应改变 Agent 的任务、审批和 Workspace 数据模型。

## 5. 执行流程

```text
Agent Runtime
  -> 已批准的 Workspace revision
  -> Sandbox API 创建 Run
  -> 复制 revision 到临时输入目录
  -> OpenSandbox 创建临时环境
  -> 运行 Node.js 命令
  -> SSE 推送 stdout / stderr / 状态
  -> 收集 allowlist 产物
  -> 返回退出码和资源用量
  -> 清理 Sandbox 与临时目录
```

正式 Workspace 目录不能直接挂载到 Sandbox。执行结果必须先作为产物回传，由 Agent Runtime 决定是否生成新的 Workspace revision。

## 6. 默认执行策略

```text
maxConcurrent: 1
timeout: 60s
cpu: 0.5-0.75 core
memory: 512-768 MiB
scratch disk: 1 GiB
processes: limited
network: denied
privileged: false
docker socket: unavailable
host mounts: unavailable
```

需要联网的能力由独立的 `webfetch` 或未来的受控出口代理提供，不通过 Sandbox 的全局网络开关放行。

第一阶段使用 rootless Docker 和 cgroup、seccomp、AppArmor 等主机策略。待执行来自不可信外部输入的代码，或未来进入多人模式后，再评估 gVisor、Kata Containers 或 Firecracker。

## 7. 运行状态

```text
queued -> running -> succeeded
                 -> failed
                 -> cancelled
```

未来接入审批时，可增加 `waiting_approval`，但 Sandbox 本身不做审批决策。

终态运行必须保留：

- 创建、启动和完成时间；
- Provider 和 Sandbox ID；
- 退出码；
- stdout / stderr 事件；
- 资源用量；
- 产物清单；
- 失败原因和可诊断错误码。

## 8. 控制 API

```text
GET  /api/runs
POST /api/runs
GET  /api/runs/:runId
GET  /api/runs/:runId/events
POST /api/runs/:runId/cancel
```

API 只接受任务输入、revision 引用和策略引用。调用方不能传入宿主机路径、Docker 参数、特权标志或任意网络规则。

## 9. 当前实现

控制台已经实现：

- 运行创建；
- 运行列表和详情；
- SSE 事件流；
- 取消运行；
- 演示 Provider 的完整状态流；
- 产物和错误状态展示。

OpenSandbox HTTP Provider 已实现生命周期创建、Execd endpoint 解析、命令 SSE 消费和结束清理。控制台暂不把自然语言任务直接转成 shell 命令；设置 `OPEN_SANDBOX_URL` 时，控制台仍会明确返回“Provider 尚未接入任务编排”的失败状态，不会让任务无限排队。

## 10. OpenSandbox 接入顺序

1. OpenSandbox Server 私网部署和生命周期健康检查。
2. 将 Agent 的结构化命令接入 Provider。
3. 通过 Execd API 写入 Workspace 快照。
4. 执行命令并消费 stdout / stderr SSE。
5. 通过文件 API 收集 allowlist 产物。
6. 取消和超时时终止 Sandbox。
7. 统一映射 OpenSandbox 错误为 ZMZAI 错误码。
8. 增加端到端测试，验证清理、网络拒绝和资源限制。
