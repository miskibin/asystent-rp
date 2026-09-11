import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import {
  createDeepAgent,
  createHarnessProfile,
  registerHarnessProfile,
} from "deepagents";
import type { Message } from "@/lib/types";

export const DEEPSEEK_MODEL = "deepseek-flash";
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DISABLED_DEEP_AGENT_TOOLS = [
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "execute",
  "task",
  "write_todos",
] as const;

export const MINIMAL_AGENT_CONFIG = {
  tools: [],
  systemPrompt: "",
  subagents: [],
  memory: [],
  skills: [],
  thinking: "disabled" as const,
  reasoning_effort: "none" as const,
};

let profileRegistered = false;

function registerMinimalProfile() {
  if (profileRegistered) return;

  const profile = createHarnessProfile({
    excludedTools: [...DISABLED_DEEP_AGENT_TOOLS],
    generalPurposeSubagent: { enabled: false },
  });
  registerHarnessProfile("openai", profile);
  registerHarnessProfile("openai:deepseek-flash", profile);
  profileRegistered = true;
}

export function createDeepSeekModel() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");

  return new ChatOpenAI({
    apiKey,
    model: DEEPSEEK_MODEL,
    streaming: true,
    maxTokens: 1024,
    configuration: { baseURL: DEEPSEEK_BASE_URL },
    // DeepSeek's OpenAI-compatible endpoint accepts these controls directly.
    // Keeping both guards makes the non-thinking invariant explicit.
    modelKwargs: {
      thinking: { type: "disabled" },
      reasoning_effort: "none",
    },
  });
}

export function createMinimalDeepAgent() {
  registerMinimalProfile();
  return createDeepAgent({
    model: createDeepSeekModel(),
    ...MINIMAL_AGENT_CONFIG,
  });
}

function toLangChainMessages(messages: Message[]) {
  return messages.map((message) =>
    message.role === "user"
      ? new HumanMessage(message.content)
      : new AIMessage(message.content)
  );
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return typeof part.text === "string" ? part.text : "";
      }
      return "";
    })
    .join("");
}

export async function* streamDeepSeek(messages: Message[]) {
  const agent = createMinimalDeepAgent();
  const stream = await agent.stream(
    { messages: toLangChainMessages(messages) },
    { streamMode: "messages" }
  );

  for await (const item of stream) {
    const chunk = Array.isArray(item) ? item[0] : item;
    const text = contentToText((chunk as { content?: unknown })?.content);
    if (text) yield text;
  }
}
