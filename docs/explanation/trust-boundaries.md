# 认证、Relay 与沙箱边界

Sandbox 不是模型网关，也不是用户数据的总数据库。它把三个责任边界串起来：身份由 Auth 负责，模型和额度由 Relay 负责，代码执行由 OpenSandbox 负责。

## 请求路径

```text
用户浏览器
  -> z.zmzai.cloud / Sandbox
       -> auth.zmzai.cloud/api/me        (验证 Cookie)
       -> m.zmzai.cloud/api/v1           (同 Cookie 调用模型)
       -> 127.0.0.1:8080                 (服务端 API Key 调 OpenSandbox)
```

浏览器只看到 Sandbox 的同源接口。Relay API Key 和 OpenSandbox API Key 不下发给浏览器，用户也不能在界面填入官方 OpenAI key。

## 为什么模型必须经过 Relay

Relay 是统一的模型目录、路由、余额和结算点。Sandbox 只选择 Relay 返回的模型，并把用户会话转发给 Relay。这样用户额度不足时可统一跳转到 `m.zmzai.cloud` 提额，也避免每个 Agent 自己管理供应商密钥。

## 为什么 OpenSandbox 必须私有

OpenSandbox API 能创建容器并执行命令。它不是给浏览器暴露的业务 API。将它放在 `127.0.0.1` 或私网中，能避免未授权方直接创建容器、探测 endpoint 或消耗主机资源。Sandbox 服务负责把自然语言限制成固定 schema，再把资源、超时和网络策略写死在 Provider 中。

## 网络默认拒绝

沙箱执行代码来自模型生成结果，不能默认假设它只会做计算。默认禁网可以阻断任意外连、下载依赖和数据外传；需要网络的能力应通过独立的 `webfetch` 工具或受控代理实现，并记录目标、用户和额度。

## 当前隔离强度

现阶段 OpenSandbox 使用 Docker `runc`，配合 CPU、内存、超时和网络 deny 策略。它适合单用户、受控服务器的前期版本，不应宣传为对抗恶意多租户代码的强隔离。未来若开放更多用户或不可信代码，再评估 rootless、seccomp/AppArmor、gVisor、Kata 或 Firecracker。

## Agent 应遵守的规则

- 只提交任务和模型标识，不提交宿主机路径、Docker 参数或网络开关；
- 只读取结构化运行结果，不把 stdout 自动当成新的命令；
- 需要写入 Workspace 时，先收集产物，再由 Agent Runtime 审批并生成新 revision；
- 把取消视为用户意图记录，而不是当前版本的强制终止保证。
