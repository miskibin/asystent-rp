import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  ToolMessage,
  ToolMessageChunk,
} from "@langchain/core/messages";
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
import { SEJM_DATA_TOOLS, SEJM_DATA_TOOL_NAMES } from "./tygodnik/tools";

export const DEEPSEEK_MODEL = "deepseek-v4-flash";
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const AGENT_RECURSION_LIMIT = 16;
export const AGENT_TOOL_CALL_LIMIT = 4;
export const AGENT_MODEL_CALL_LIMIT = 5;
export const AGENT_SYSTEM_PROMPT = [
  "Odpowiadaj po polsku, jasno i konkretnie.",
  "Gdy pytanie dotyczy Sejmu, polityków, ustaw, głosowań lub wypowiedzi, najpierw użyj właściwego narzędzia.",
  "Opieraj fakty wyłącznie na zwróconych danych, podawaj istotne liczby i daty, a źródła cytuj tylko jako dokładne adresy URL z wyniku narzędzia.",
  "Jeśli danych brakuje, powiedz czego nie udało się potwierdzić.",
  "Nie pokazuj technicznych rankingów ani metadanych retrievalu.",
].join(" ");
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
  tools: SEJM_DATA_TOOLS,
  systemPrompt: AGENT_SYSTEM_PROMPT,
  subagents: [],
  memory: [],
  skills: [],
  thinking: "disabled" as const,
  reasoning_effort: "none" as const,
};

export type AgentStreamEvent =
  | { type: "text"; content: string }
  | { type: "tool_start"; id: string; name: string; input: string }
  | { type: "tool_update"; id: string; name: string; input: string }
  | { type: "tool_end"; id: string; name: string; output: string; status: "done" | "error" };

const approvedToolNames = new Set<string>(SEJM_DATA_TOOL_NAMES);

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
    maxTokens: 1_800,
    configuration: { baseURL: DEEPSEEK_BASE_URL },
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
      toolCallLimitMiddleware({ runLimit: AGENT_TOOL_CALL_LIMIT, exitBehavior: "continue" }),
      modelCallLimitMiddleware({ runLimit: AGENT_MODEL_CALL_LIMIT, exitBehavior: "end" }),
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

type ToolState = {
  id: string;
  name: string;
  input: string;
  started: boolean;
};

export async function* streamAgentEvents(items: AsyncIterable<unknown>): AsyncGenerator<AgentStreamEvent> {
  const callsByIndex = new Map<number, ToolState>();
  const callsById = new Map<string, ToolState>();
  let anonymousCall = 0;

  for await (const item of items) {
    const chunk = Array.isArray(item) ? item[0] : item;

    if (AIMessageChunk.isInstance(chunk)) {
      const text = contentToText(chunk.content);
      if (text) yield { type: "text", content: text };

      for (const toolChunk of chunk.tool_call_chunks ?? []) {
        const index = toolChunk.index ?? 0;
        let state = callsByIndex.get(index);
        if (!state) {
          state = {
            id: toolChunk.id || `tool-${index}-${++anonymousCall}`,
            name: toolChunk.name || "tool",
            input: "",
            started: false,
          };
          callsByIndex.set(index, state);
        }
        if (toolChunk.id && state.id.startsWith("tool-")) state.id = toolChunk.id;
        if (toolChunk.name) state.name = toolChunk.name;
        if (toolChunk.args) state.input += toolChunk.args;
        callsById.set(state.id, state);

        if (!state.started && state.name !== "tool") {
          state.started = true;
          yield { type: "tool_start", id: state.id, name: state.name, input: state.input };
        } else if (state.started && toolChunk.args) {
          yield { type: "tool_update", id: state.id, name: state.name, input: state.input };
        }
      }
      continue;
    }

    if (AIMessage.isInstance(chunk)) {
      const text = contentToText(chunk.content);
      if (text) yield { type: "text", content: text };
      for (const call of chunk.tool_calls ?? []) {
        const id = call.id || `tool-final-${++anonymousCall}`;
        if (callsById.has(id)) continue;
        const state: ToolState = {
          id,
          name: call.name,
          input: JSON.stringify(call.args ?? {}),
          started: true,
        };
        callsById.set(id, state);
        yield { type: "tool_start", id, name: state.name, input: state.input };
      }
      continue;
    }

    if (ToolMessage.isInstance(chunk) || ToolMessageChunk.isInstance(chunk)) {
      const id = chunk.tool_call_id;
      const state = callsById.get(id);
      const name = chunk.name || state?.name || "tool";
      yield {
        type: "tool_end",
        id,
        name,
        output: contentToText(chunk.content),
        status: chunk.status === "error" ? "error" : "done",
      };
    }
  }
}

export async function* streamDeepSeek(messages: Message[], signal?: AbortSignal) {
  const agent = createMinimalDeepAgent();
  const stream = await agent.stream(
    { messages: toLangChainMessages(messages) },
    { streamMode: "messages", recursionLimit: AGENT_RECURSION_LIMIT, signal }
  );

  yield* streamAgentEvents(stream as AsyncIterable<unknown>);
}