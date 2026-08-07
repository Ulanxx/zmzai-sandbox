import { randomUUID } from "node:crypto";

import { relayRequest } from "@/lib/relay-client";

export type AgentCommand = {
  language: "javascript" | "python" | "shell";
  code: string;
  timeoutMs: number;
};

const runCodeTool = {
  type: "function",
  function: {
    name: "run_code",
    description: "在临时隔离沙箱中执行一段短代码并返回标准输出。不要访问网络，不要执行破坏宿主机的操作。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        language: { type: "string", enum: ["javascript", "python", "shell"] },
        code: { type: "string", minLength: 1, maxLength: 12_000 },
        timeoutMs: { type: "integer", minimum: 1_000, maximum: 60_000 },
      },
      required: ["language", "code", "timeoutMs"],
    },
  },
} as const;

function parseArguments(raw: unknown): AgentCommand {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!value || typeof value !== "object") throw new Error("Agent 没有返回结构化命令");
  const command = value as Record<string, unknown>;
  if (!(["javascript", "python", "shell"] as const).includes(command.language as AgentCommand["language"])) throw new Error("Agent 返回了不支持的语言");
  if (typeof command.code !== "string" || command.code.trim().length === 0 || command.code.length > 12_000) throw new Error("Agent 返回的代码无效");
  const timeoutMs = typeof command.timeoutMs === "number" && Number.isFinite(command.timeoutMs) ? Math.round(command.timeoutMs) : 30_000;
  if (timeoutMs < 1_000 || timeoutMs > 60_000) throw new Error("Agent 返回的超时时间无效");
  return { language: command.language as AgentCommand["language"], code: command.code, timeoutMs };
}

function parseContent(content: unknown): AgentCommand {
  if (typeof content !== "string") throw new Error("Agent 没有返回可执行命令");
  const json = content.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() ?? content.trim();
  return parseArguments(json);
}

export async function planTask(request: Request, model: string, task: string) {
  const response = await relayRequest(request, "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      max_tokens: 500,
      requestId: `sandbox_${randomUUID()}`,
      messages: [
        {
          role: "system",
          content: "你是 ZMZAI 沙箱的安全命令规划器。你必须调用一次 run_code 工具来完成用户任务。优先使用 javascript；只生成短小、可验证的计算或文本处理代码。不要解释，不要生成访问网络、读取宿主机或删除数据的命令。",
        },
        { role: "user", content: task },
      ],
      tools: [runCodeTool],
      tool_choice: { type: "function", function: { name: "run_code" } },
    }),
  });

  const body = (await response.json().catch(() => null)) as { error?: string; choices?: Array<{ message?: { content?: unknown; tool_calls?: Array<{ function?: { arguments?: unknown } }> } }> } | null;
  if (!response.ok) throw new Error(body?.error || `Relay 返回 HTTP ${response.status}`);
  const message = body?.choices?.[0]?.message;
  const toolArguments = message?.tool_calls?.[0]?.function?.arguments;
  return toolArguments !== undefined ? parseArguments(toolArguments) : parseContent(message?.content);
}

export function commandForAgent(command: AgentCommand) {
  const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
  if (command.language === "shell") return command.code;
  return `${command.language === "python" ? "python3 -c" : "node -e"} ${shellQuote(command.code)}`;
}

export function imageForAgent(command: AgentCommand) {
  if (command.language === "python") return "python:3.12-alpine";
  return process.env.OPEN_SANDBOX_IMAGE?.trim() || "node:22-alpine";
}
