import { describe, expect, it } from "vitest";

import { quoteExecdArgument } from "@/lib/execd-shell";

describe("quoteExecdArgument", () => {
  it("uses the Execd-compatible double-quote form for JavaScript containing single quotes", () => {
    expect(quoteExecdArgument("console.log('quote-probe')")).toBe('"console.log(\'quote-probe\')"');
  });

  it("escapes shell expansion characters without changing the argument", () => {
    expect(quoteExecdArgument('say "$HOME" `whoami` \\ path')).toBe('"say \\"\\$HOME\\" \\`whoami\\` \\\\ path"');
  });
});
