# 第一次执行：让 Agent 在沙箱中回答 1+1

本教程会使用现有的 `z.zmzai.cloud` 示例客户端，完成一次真实链路：登录、选择 Relay 模型、提交任务、查看 SSE 输出。

## 你需要什么

- 一个可登录 `auth.zmzai.cloud` 的 ZMZAI 账号；
- 账号有可用额度和至少一个已启用模型；
- 浏览器能访问 `https://z.zmzai.cloud/`。

用户不需要、也不能在 Sandbox 中填写 OpenAI 或其他供应商的 API Key。

## 步骤 1：登录

打开 [Sandbox 控制台](https://z.zmzai.cloud/)，点击登录。登录完成后回到控制台，页面会通过服务端读取会话并加载 Relay 返回的模型目录。

## 步骤 2：提交任务

在任务输入框写入：

```text
1+1=几？请在沙箱中计算并输出结果。
```

选择一个可用模型并提交。Sandbox 服务端会把任务交给 Relay，请 Relay 只生成结构化的 `run_code` 调用，再把经过本地校验的命令交给 OpenSandbox。

## 步骤 3：查看事件

运行详情通过 SSE 更新。你会看到规划状态、标准输出或错误输出，以及最终状态和退出码。正常结果应包含 `2`，最终状态为 `succeeded`，退出码为 `0`。

## 这次运行实际发生了什么

```text
浏览器 Cookie
  -> Sandbox 校验 auth.zmzai.cloud 会话
  -> Sandbox 转发同一 Cookie 到 m.zmzai.cloud
  -> Relay 返回一次 run_code(language, code, timeoutMs)
  -> Sandbox 校验结构并创建临时 OpenSandbox
  -> Execd 通过 SSE 返回 stdout/stderr
  -> Sandbox 删除临时环境
```

如果余额不足，Relay 会在创建沙箱前返回计费错误；如果模型返回的命令不符合 schema，运行会失败并记录原因，也不会执行未经校验的用户文本。

## 下一步

想从自己的 Agent 调用时，阅读 [接入 ZMZAI Agent](../how-to/integrate-agent.md)。想自建控制面，阅读 [自建 OpenSandbox](../how-to/self-host-opensandbox.md)。
