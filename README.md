# 沙箱场 · zmzai cloud

> 代码执行与 Agent 实验的沙箱

zmzai cloud 牧之 产品矩阵的子产品（字母 **Z**）。

```bash
pnpm install
pnpm dev
```

## 当前状态

当前版本是 Sandbox Runner 控制台的第一条可验证闭环：

- 创建一次运行并查看任务状态；
- 通过 Server-Sent Events 接收实时事件流；
- 取消排队中或执行中的任务；
- 查看退出码和生成的产物；
- 通过 Provider 边界为 OpenSandbox 接入预留位置。
- `GET /api/provider` 提供 OpenSandbox 配置和健康检查。

默认使用内置演示 Provider，不会执行宿主机命令。设置 `OPEN_SANDBOX_URL` 后，
任务会明确提示 OpenSandbox 适配器尚未接入，不会静默排队。

`OpenSandboxProvider` 的生命周期和命令 SSE 已实现。下一步是由 Agent Runtime
传入结构化命令，并补上已批准 Workspace 快照的文件上传和产物回传。

Apache-2.0 · 牧之
