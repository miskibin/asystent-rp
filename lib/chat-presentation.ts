import type { ChatMessageData } from "@/components/ui/message-list";
import { displayToolName } from "./grounded-response";
import type { ChatToolStep, Message } from "./types";

const DATA_TOOLS = new Set([
  "get_latest_sejm_sitting", "search_sejm_data", "get_sejm_record",
  "search_legal_provisions", "get_legal_provision", "get_legal_changes",
].flatMap((name) => [name, displayToolName(name)]));

function visibleTool(tool: ChatToolStep, streaming: boolean): ChatToolStep | null {
  if (!DATA_TOOLS.has(tool.name)) return null;
  const interrupted = !streaming && (tool.status === "running" || tool.status === "pending");
  return {
    ...tool,
    name: displayToolName(tool.name),
    ...(interrupted ? { status: "error" as const, output: "Działanie zostało przerwane." } : {}),
  };
}

/** Show the retrieval trace, without reviving historical presentation tools or model reasoning. */
export function presentChatMessage(message: Message, streaming = false): ChatMessageData {
  const base: ChatMessageData = { id: message.id, sender: message.role === "user" ? "user" : "assistant", content: message.content };
  if (message.role !== "assistant") return base;
  const parts: NonNullable<ChatMessageData["parts"]> = [];
  if (message.parts?.length) {
    for (const part of message.parts) {
      if (part.type === "text") parts.push(part);
      if (part.type === "tool") {
        const tool = visibleTool(part.tool, streaming);
        if (tool) parts.push({ ...part, tool });
      }
    }
  } else {
    for (const original of message.tools ?? []) {
      const tool = visibleTool(original, streaming);
      if (tool) parts.push({ type: "tool", id: `tool-${tool.id}`, tool });
    }
  }
  if (!parts.some((part) => part.type === "tool")) return base;
  // Older stored traces can contain only tools; keep their answer visible too.
  if (!parts.some((part) => part.type === "text") && message.content) {
    parts.push({ type: "text", id: `answer-${message.id}`, text: message.content });
  }
  return { ...base, parts, workedFor: message.workedFor };
}
