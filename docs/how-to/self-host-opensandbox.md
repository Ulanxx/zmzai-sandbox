# 自建 OpenSandbox 控制面

本文针对单台香港服务器的前期部署。目标是让 OpenSandbox 只做私有执行控制面，由 `zmzai-sandbox` 负责鉴权、Relay 调用、策略和结果映射。

## 推荐拓扑

```text
公网
  -> Caddy
      -> z.zmzai.cloud:3010 (Sandbox 控制 API + 示例页面)
      -> m.zmzai.cloud:3002 (Relay)
      -> auth.zmzai.cloud:3001 (登录)

127.0.0.1:8080 (OpenSandbox Server, 不暴露公网)
  -> Docker runtime (当前为 runc)
      -> 临时 node:22-alpine sandbox
```

OpenSandbox 的 API Key 只存在 Sandbox 服务端环境变量中。浏览器、Relay 和 Agent 都不应直接拿到它。

## Sandbox 应用配置

在 Sandbox 服务端设置：

```dotenv
AUTH_URL=https://auth.zmzai.cloud
RELAY_URL=https://m.zmzai.cloud/api/v1
OPEN_SANDBOX_URL=http://127.0.0.1:8080
OPEN_SANDBOX_API_KEY=<服务端密钥>
OPEN_SANDBOX_PROTOCOL=http
OPEN_SANDBOX_IMAGE=node:22-alpine
OPEN_SANDBOX_CPU_LIMIT=500m
OPEN_SANDBOX_MEMORY_LIMIT=512Mi
```

变量含义和默认值见 [环境变量参考](../reference/configuration.md)。密钥文件应由运行用户读取，权限建议为 `0600`，不要提交到 Git 或打印到日志。

## 验证控制面

部署后从 Sandbox 服务端执行健康检查：

```bash
curl -fsS https://z.zmzai.cloud/api/provider
```

正常时返回 `provider=opensandbox`、`configured=true`、`healthy=true`。该端点只报告健康状态和配置的基础 URL，不应把 API Key 返回给客户端。

## 验证一次真实执行

使用已登录会话从控制台提交教程中的 `1+1` 任务。执行完成后，OpenSandbox 临时实例会被删除。检查服务器上的 OpenSandbox 列表，正常情况下不会留下 `zmzai.managed=true` 的已完成实例。

## 资源策略

当前默认每次运行 0.5 CPU、512 MiB 内存，命令超时上限 60 秒，网络策略为 `deny`。单服务器前期应限制并发，并监控 Docker cgroup、磁盘和宿主机内存。当前 runtime 是 Docker `runc`，它不是 gVisor、Kata 或 Firecracker 级别的隔离。

需要联网时，增加独立的 `webfetch` 或受控出口服务，不要把 OpenSandbox 的全局网络默认改成允许。

## 故障排查

- `/api/provider` 返回 503：检查 OpenSandbox 是否监听 `127.0.0.1:8080`、API Key 是否匹配，以及 Sandbox 进程是否能访问该地址。
- Relay 返回 401：登录 Cookie 已过期，重新登录 `auth.zmzai.cloud`。
- Relay 返回 402：用户额度不足，前往 [m.zmzai.cloud](https://m.zmzai.cloud/) 提额。
- 运行失败但没有沙箱：通常是模型目录、Relay 或 `run_code` schema 校验失败，先看运行事件。
- 沙箱执行超时：降低任务规模或提高服务端策略前先确认并发、CPU 和内存余量。
