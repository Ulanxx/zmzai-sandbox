# 沙箱场 · zmzai cloud

> 代码执行与 Agent 实验的沙箱

zmzai cloud 牧之 产品矩阵的子产品（字母 **Z**）。

```bash
pnpm install
pnpm dev
```

## 当前状态

当前版本是 Sandbox Runner 控制台的第一条可验证闭环：

- 登录后读取 Relay 可用模型，并创建一次 Agent 运行；
- 由 Relay 生成结构化 `run_code` 命令并在 OpenSandbox 中执行；
- 通过 Server-Sent Events 接收实时事件流；
- 取消排队中或执行中的任务；
- 查看退出码和生成的产物；
- 通过 Provider 边界接入 OpenSandbox。
- `GET /api/provider` 提供 OpenSandbox 配置和健康检查。

用户不在 Sandbox 输入 API Key。登录会话由 `auth.zmzai.cloud` 校验，模型调用继续
通过 `m.zmzai.cloud` 按用户额度结算。未登录时控制台只显示登录入口，不会返回模型目录。

`OpenSandboxProvider` 的生命周期和命令 SSE 已实现。当前 Agent 第一版只支持一次
结构化 `run_code` 调用；Workspace 快照、文件产物和多工具循环留给后续 Agent Runtime。

Apache-2.0 · 牧之
