import { describe, expect, it, beforeEach } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import {
  createDeepSeekModel,
  createMinimalDeepAgent,
  DISABLED_DEEP_AGENT_TOOLS,
  MINIMAL_AGENT_CONFIG,
  toLangChainMessages,
} from "../lib/deepseek-agent";

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = "test-key";
});

describe("minimal DeepSeek agent invariants", () => {
  it("exposes exactly one model configuration with thinking disabled", () => {
    const model = createDeepSeekModel();

    expect(model.model).toBe("deepseek-flash");
    expect(model.maxTokens).toBe(1024);
    expect(model.modelKwargs).toMatchObject({
      thinking: { type: "disabled" },
      reasoning_effort: "none",
    });
  });

  it("does not configure system prompts, tools, memory, or subagents", () => {
    expect(MINIMAL_AGENT_CONFIG.systemPrompt).toBe("");
    expect(MINIMAL_AGENT_CONFIG.tools).toHaveLength(0);
    expect(MINIMAL_AGENT_CONFIG.subagents).toHaveLength(0);
    expect(MINIMAL_AGENT_CONFIG.memory).toHaveLength(0);
    expect(MINIMAL_AGENT_CONFIG.skills).toHaveLength(0);
    expect(DISABLED_DEEP_AGENT_TOOLS).toEqual(
      expect.arrayContaining([
        "ls",
        "read_file",
        "write_file",
        "edit_file",
        "glob",
        "grep",
        "execute",
        "task",
        "write_todos",
      ])
    );
  });

  it("constructs Deep Agents without exposing custom tools", () => {
    const agent = createMinimalDeepAgent();
    expect(agent.options.tools).toHaveLength(0);
  });

  it("converts only user and assistant messages", () => {
    const messages = toLangChainMessages([
      { id: "u", role: "user", content: "Cześć" },
      { id: "a", role: "assistant", content: "Hej" },
    ]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toBeInstanceOf(HumanMessage);
    expect(messages[1]).toBeInstanceOf(AIMessage);
    expect(messages.some((message) => message.getType() === "system")).toBe(false);
  });
});
