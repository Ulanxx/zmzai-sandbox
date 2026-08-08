# ZMZAI Sandbox

> 面向 ZMZAI Agent 的临时、受限代码执行层。

这个仓库的主要产物是开发者接入文档和 Sandbox Runner API。`z.zmzai.cloud` 上的页面只是一个用于验证链路的示例客户端，不是 Agent 必须依赖的产品界面。

## 从这里开始

- [文档总览](docs/README.md)
- [第一次执行：让 Agent 在沙箱中回答 `1+1`](docs/tutorials/first-authenticated-run.md)
- [接入 ZMZAI Agent](docs/how-to/integrate-agent.md)
- [HTTP 与 SSE API 参考](docs/reference/http-api.md)
- [环境变量参考](docs/reference/configuration.md)
- [认证、Relay 与沙箱边界](docs/explanation/trust-boundaries.md)
- [线上开发者工作台](https://z.zmzai.cloud/developers)

## 当前可用能力

- 登录会话鉴权，用户不填写或接触任何模型 API Key；
- 通过 `m.zmzai.cloud` Relay 获取用户可用模型并完成模型调用与额度结算；
- 将自然语言任务转换为一次经过校验的结构化 `run_code` 命令；
- 在私有 OpenSandbox 中创建临时执行环境，默认禁网、限时、限 CPU 和内存；
- 通过 Server-Sent Events 接收 stdout、stderr 和状态事件；
- 查询、取消和清理运行记录。

## 当前边界

当前实现是控制台验证闭环，不是稳定的第三方 SDK：运行记录保存在进程内存中，提交接口使用登录 Cookie，单次运行只支持一个 `run_code` 工具调用。Workspace 快照、文件产物、多工具循环和服务间签发的 Agent Token 仍在设计中，见 [稳定 Runner API 设计](docs/superpowers/specs/agent-runner-api-design.md)。

开发者预览现已支持创建只授权 Sandbox Runner 的 `sandbox_key`（`zsk_...`）并通过 `POST /api/v1/runs` 调用。密钥明文只会在创建时展示一次，模型调用、额度和结算仍由 Relay 统一负责。服务端接入和完整请求示例位于 [开发者工作台](https://z.zmzai.cloud/developers)。

OpenSandbox 只应监听服务器回环地址或私网地址。当前部署使用 Docker `runc`，不能把它描述为 VM、gVisor 或强多租户隔离。

## 本地开发

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

完整的服务端配置、生产部署和排错步骤见 [自建 OpenSandbox](docs/how-to/self-host-opensandbox.md)。

Apache-2.0 · 牧之
