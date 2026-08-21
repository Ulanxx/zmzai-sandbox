import { describe, expect, it } from "vitest";

import { commandForAgent } from "@/lib/agent-planner";

describe("commandForAgent", () => {
  it("keeps single quotes in JavaScript code for Execd", () => {
    expect(commandForAgent({ language: "javascript", code: "console.log('ready')", timeoutMs: 1_000 }))
      .toBe('node -e "console.log(\'ready\')"');
  });

  it("leaves an explicitly requested shell command unchanged", () => {
    expect(commandForAgent({ language: "shell", code: "echo ready", timeoutMs: 1_000 })).toBe("echo ready");
  });
});
