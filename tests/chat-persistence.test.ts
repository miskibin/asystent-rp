import { describe, expect, it } from "vitest";

import {
  MODEL_HISTORY_CHAR_LIMIT,
  MODEL_HISTORY_MESSAGE_LIMIT,
  titleFromMessage,
  trimModelHistory,
} from "../lib/chat-persistence";

describe("chat persistence limits", () => {
  it("creates a compact deterministic title", () => {
    expect(titleFromMessage("  Co  wydarzyło się\nna posiedzeniu? ")).toBe(
      "Co wydarzyło się na posiedzeniu?"
    );
    expect(titleFromMessage("x".repeat(100))).toBe(`${"x".repeat(57)}…`);
  });

  it("keeps only the newest bounded model context", () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({
      id: String(index),
      role: index % 2 ? "assistant" : "user",
      content: `${index}:` + "x".repeat(2_000),
    }));

    const trimmed = trimModelHistory(messages);
    expect(trimmed.length).toBeLessThanOrEqual(MODEL_HISTORY_MESSAGE_LIMIT);
    expect(trimmed.reduce((sum, entry) => sum + entry.content.length, 0)).toBeLessThanOrEqual(
      MODEL_HISTORY_CHAR_LIMIT
    );
    expect(trimmed.at(-1)?.id).toBe("19");
  });
});
