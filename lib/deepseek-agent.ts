import { AIMessage, AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import {
  createMiddleware,
  modelCallLimitMiddleware,
  toolCallLimitMiddleware,
} from "langchain";
import {
  createDeepAgent,
  createHarnessProfile,
  registerHarnessProfile,
} from "deepagents";
import type { Message } from "./types";
import { TYGODNIK_TOOLS, TYGODNIK_TOOL_NAMES } from "./tygodnik/tools";

export const DEEPSEEK_MODEL = "deepseek-flash";
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const AGENT_RECURSION_LIMIT = 16;
export const DISABLED_DEEP_AGENT_TOOLS = [
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
] as const;

export const MINIMAL_AGENT_CONFIG = {
  tools: TYGODNIK_TOOLS,
  systemPrompt: "",
  subagents: [],
  memory: [],
  skills: [],
  thinking: "disabled" as const,
  reasoning_effort: "none" as const,
};

const approvedToolNames = new Set<string>(TYGODNIK_TOOL_NAMES);

// Deep Agents installs filesystem/task middleware internally. This boundary
// guarantees that the model receives only the three read-only data tools even
// if a future harness profile or provider match changes.
export const approvedToolBoundaryMiddleware = createMiddleware({
  name: "ApprovedToolBoundary",
  wrapModelCall: (request, handler) =>
    handler({
      ...request,
      tools: request.tools.filter((entry) => approvedToolNames.has(String(entry.name))),
    }),
  wrapToolCall: (request, handler) => {
    if (!approvedToolNames.has(String(request.toolCall.name))) {
      throw new Error(`Tool is not available: ${request.toolCall.name}`);
    }
    return handler(request);
  },
});

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
    middleware: [
      approvedToolBoundaryMiddleware,
      toolCallLimitMiddleware({ runLimit: 2, exitBehavior: "continue" }),
      modelCallLimitMiddleware({ runLimit: 3, exitBehavior: "end" }),
    ],
  });
}

export function toLangChainMessages(messages: Message[]) {
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

export async function* streamDeepSeek(messages: Message[], signal?: AbortSignal) {
  const agent = createMinimalDeepAgent();
  const stream = await agent.stream(
    { messages: toLangChainMessages(messages) },
    { streamMode: "messages", recursionLimit: AGENT_RECURSION_LIMIT, signal }
  );

  for await (const item of stream) {
    const chunk = Array.isArray(item) ? item[0] : item;
    if (!AIMessageChunk.isInstance(chunk) && !AIMessage.isInstance(chunk)) continue;
    const text = contentToText((chunk as { content?: unknown })?.content);
    if (text) yield text;
  }
}
