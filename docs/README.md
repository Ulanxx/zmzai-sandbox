# ZMZAI Sandbox 开发文档

ZMZAI Sandbox 是 Agent 的代码执行层。调用方提交任务，Runner 负责在临时沙箱中执行受限命令并返回日志、状态和退出码。模型调用不在本项目中完成，统一经过 `m.zmzai.cloud` Relay。

## 按目标阅读

### 我想先跑起来

- [第一次执行](tutorials/first-authenticated-run.md)：用现有登录会话完成一次 `1+1` 运行。

### 我要接入 Agent

- [接入 ZMZAI Agent](how-to/integrate-agent.md)：当前控制台型接入方式、Cookie 转发要求，以及未来服务间 API 的迁移边界。
- [稳定 Runner API 设计](superpowers/specs/agent-runner-api-design.md)：面向 `zmzai-agent` 的下一版合约草案。

### 我要自建运行环境

- [自建 OpenSandbox](how-to/self-host-opensandbox.md)：香港服务器上的私有控制面、Caddy 和运行时配置。

### 我要查接口和配置

- [HTTP 与 SSE API](reference/http-api.md)
- [环境变量](reference/configuration.md)

### 我想理解安全边界

- [信任边界与网络策略](explanation/trust-boundaries.md)

## 版本标记

文档中的“当前可用”表示已经部署在 `z.zmzai.cloud` 的实现；“设计中”表示接口方向，不应直接写入生产 Agent。当前 API 没有独立的公开版本承诺，接入方应锁定部署版本并通过 `/api/provider` 做健康检查。
