import { describe, expect, it, beforeEach } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import {
  AGENT_RECURSION_LIMIT,
  approvedToolBoundaryMiddleware,
  createDeepSeekModel,
  createMinimalDeepAgent,
  DISABLED_DEEP_AGENT_TOOLS,
  MINIMAL_AGENT_CONFIG,
  toLangChainMessages,
} from "../lib/deepseek-agent";
import { SEJM_DATA_TOOL_NAMES } from "../lib/tygodnik/tools";

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = "test-key";
});

describe("minimal DeepSeek agent invariants", () => {
  it("leaves enough graph steps for the hard model and tool limits to finish", () => {
    expect(AGENT_RECURSION_LIMIT).toBe(16);
  });

  it("exposes exactly one model configuration with thinking disabled", () => {
    const model = createDeepSeekModel();

    expect(model.model).toBe("deepseek-flash");
    expect(model.maxTokens).toBe(1024);
    expect(model.modelKwargs).toMatchObject({
      thinking: { type: "disabled" },
      reasoning_effort: "none",
    });
  });

  it("configures only the three bounded Tygodnik tools", () => {
    expect(MINIMAL_AGENT_CONFIG.systemPrompt).toBe("");
    expect(MINIMAL_AGENT_CONFIG.tools.map((entry) => entry.name)).toEqual([
      "search_sejm_data",
      "get_sejm_record",
      "get_latest_sejm_sitting",
    ]);
    expect(MINIMAL_AGENT_CONFIG.subagents).toHaveLength(0);
    expect(MINIMAL_AGENT_CONFIG.memory).toHaveLength(0);
    expect(MINIMAL_AGENT_CONFIG.skills).toHaveLength(0);
    expect(DISABLED_DEEP_AGENT_TOOLS).toEqual(
      expect.arrayContaining([
        "ls",
        "read_file",
        "write_file",
        "edit_file",
        "delete",
        "glob",
        "grep",
        "execute",
        "task",
        "write_todos",
      ])
    );
  });

  it("constructs Deep Agents with exactly the approved custom tools", () => {
    const agent = createMinimalDeepAgent();
    expect(agent.options.tools?.map((entry) => entry.name)).toEqual(SEJM_DATA_TOOL_NAMES);
  });

  it("filters model-visible tools through a hard allowlist", async () => {
    const seen: string[] = [];
    const request = {
      tools: [
        { name: "delete" },
        { name: "search_sejm_data" },
        { name: "execute" },
        { name: "get_latest_sejm_sitting" },
      ],
    };

    await approvedToolBoundaryMiddleware.wrapModelCall!(
      request as never,
      ((next: typeof request) => {
        seen.push(...next.tools.map((entry) => entry.name));
        return new AIMessage("ok");
      }) as never
    );

    expect(seen).toEqual(["search_sejm_data", "get_latest_sejm_sitting"]);
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