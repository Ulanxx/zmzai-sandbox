# 沙箱后端选型

这份文档回答一个问题：**想像 Cloudflare 那样省资源，除了 OpenSandbox 还能选什么**。

先说结论：

- 如果你说的“省资源”是 **机器成本**，OpenSandbox 这类自建轻沙箱通常不差，甚至更便宜
- 如果你说的“省资源”是 **少维护基础设施**，Cloudflare Sandbox、E2B、Modal、Daytona 这类托管方案更省心
- 如果你要的是 **复杂 Agent 工作区**，就不要只盯着“能不能跑代码”，还要看文件系统、网络、git、长任务和隔离强度

## 快速对照

| 方案 | 形态 | 更省机器资源? | 更省运维? | 适合什么 |
| --- | --- | --- | --- | --- |
| OpenSandbox | 自建控制面 + 临时容器 | 通常是 | 还可以，但要自己管 | 短任务、低成本、可控环境 |
| Cloudflare Sandbox | Cloudflare 托管 | 不一定 | 是 | Cloudflare 体系内的 Agent 执行层 |
| E2B BYOC | 托管控制面 + 你的 VPC | 不一定 | 是 | 想要强隔离，又想少管集群 |
| Modal Sandboxes | 托管云计算 | 不一定 | 是 | Python、数据处理、弹性任务 |
| Daytona | 托管 workspace / 你的云 | 不一定 | 是 | 更像 Agent 电脑，适合完整工作区 |

## 怎么理解“省资源”

这里的“资源”其实有两种：

1. **CPU / 内存 / 磁盘**
2. **人力和运维成本**

OpenSandbox 这条路在第一项上通常很有竞争力，因为它很直接，路径短，启动和销毁都简单。你现在仓库里的默认配置也是偏轻的：每次大约 `0.5 CPU`、`512 MiB` 内存，网络默认关掉。

托管方案的优势不在“每次跑得更省”，而在于：

- 不用自己维护控制面
- 不用自己做弹性、调度、观测和恢复
- 更容易把工作区能力做完整

## 适用建议

- 你现在这条线，继续把 OpenSandbox 当 **保底执行层** 很合理
- 如果想进一步省运维，优先看 **Cloudflare Sandbox** 或 **E2B BYOC**
- 如果任务偏数据和 Python，**Modal** 很顺手
- 如果你想把 Agent 真正变成“有桌面、有文件系统、有工作区”的东西，**Daytona** 更像最终形态

## 对 `z.zmzai.cloud` 的建议

最稳的做法不是立刻换掉 OpenSandbox，而是分层：

- **轻任务**：isolate / 托管轻执行层
- **中任务**：OpenSandbox 或 E2B / Modal
- **重任务**：完整 workspace / 更强隔离环境

这样你既保留现在的成本优势，也给未来的复杂 Agent 能力留出路。

## 参考

- [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/)
- [E2B BYOC](https://e2b.dev/docs/byoc)
- [Modal Sandboxes](https://modal.com/docs/guide/sandboxes)
- [Daytona](https://www.daytona.io/)
