# ZMZAI Agent 执行镜像：node + python3 + python-pptx
#
# 构建后配置到 z.zmzai.cloud 的 OPEN_SANDBOX_IMAGE：
#   docker build -f docker/agent-python.Dockerfile -t zmzai-agent-python:1 .
#   OPEN_SANDBOX_IMAGE=<registry>/zmzai-agent-python:1
#
# python-pptx 预装，模型写 Python 脚本即可生成 .pptx；命令白名单已含 python3，
# 运行时不做网络安装（沙箱默认禁网）。
FROM python:3.12-alpine

RUN apk add --no-cache nodejs npm git \
  && pip install --no-cache-dir python-pptx==1.0.2 \
  && rm -rf /root/.cache/pip

WORKDIR /work
