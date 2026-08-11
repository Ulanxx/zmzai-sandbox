# ZMZAI Agent 执行基础镜像：node + python3 + 常用包
#
# 构建（在有 Docker 的服务器/CI 上）：
#   docker build -f docker/agent-python.Dockerfile -t zmzai-agent-python:1 .
# 然后配置 z.zmzai.cloud 的 OPEN_SANDBOX_IMAGE=zmzai-agent-python:1
#
# 覆盖能力：
#   - Node 22 + npm/npx（含 tsx，可直接运行 .ts）
#   - Python 3 + pip（预装 python-pptx 生成 PPT；pytest 校验；pillow 生成图片）
#   - 基础工具：bash / git / curl / unzip / tar / ca-certificates
# 沙箱默认禁网，运行时不做网络安装；镜像构建阶段才有网络。
#
# 注意：这条镜像是「执行环境」，不是应用镜像；不得包含任何密钥或宿主路径。

FROM node:22-alpine

# OS 基础包 + Python 3（node:22-alpine 已含 node/npm/npx）
RUN apk add --no-cache bash git curl unzip tar ca-certificates python3 py3-pip \
  && rm -rf /var/cache/apk/*

# Python 常用库（PPT 验收 / 测试）。需要图片能力时再补 pillow（需 jpeg/zlib 构建依赖）。
RUN pip install --no-cache-dir --break-system-packages \
  python-pptx==1.0.2 \
  pytest==8.3.4 \
  && rm -rf /root/.cache/pip

# Node 常用工具：tsx 让 Agent 可以直接运行 TypeScript
RUN npm install -g tsx@4.19.2 --no-audit --no-fund \
  && npm cache clean --force

WORKDIR /work
