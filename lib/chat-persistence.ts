import type { SupabaseClient } from "@supabase/supabase-js";

import type { Message } from "./types";

type StoredProcess = Pick<Message, "parts" | "tools" | "workedFor">;

export type ChatThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export const CHAT_LIST_LIMIT = 50;
export const CHAT_MESSAGE_LIMIT = 200;
export const MODEL_HISTORY_MESSAGE_LIMIT = 12;
export const MODEL_HISTORY_CHAR_LIMIT = 16_000;
export const USER_MESSAGE_CHAR_LIMIT = 4_000;

export async function listChatThreads(client: SupabaseClient): Promise<ChatThread[]> {
  const { data, error } = await client
    .from("chat_threads")
    .select("id,title,created_at,updated_at")
    .order("updated_at", { ascending: false })
    .limit(CHAT_LIST_LIMIT);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

function storedProcess(value: unknown): StoredProcess {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const process = value as StoredProcess;
  return {
    parts: Array.isArray(process.parts) ? process.parts : undefined,
    tools: Array.isArray(process.tools) ? process.tools : undefined,
    workedFor: typeof process.workedFor === "number" ? process.workedFor : undefined,
  };
}

export async function loadChatMessages(client: SupabaseClient, threadId: string): Promise<Message[]> {
  const { data, error } = await client
    .from("chat_messages")
    .select("id,role,content,message_order,process")
    .eq("thread_id", threadId)
    .order("message_order", { ascending: false })
    .limit(CHAT_MESSAGE_LIMIT);
  if (error) throw error;
  return (data ?? []).reverse().map((row) => ({
    id: row.id as string,
    role: row.role as "user" | "assistant",
    content: row.content as string,
    ...storedProcess(row.process),
  }));
}

export async function deleteChatThread(client: SupabaseClient, threadId: string) {
  const { error } = await client.from("chat_threads").delete().eq("id", threadId);
  if (error) throw error;
}

export async function deletePersistedMessage(client: SupabaseClient, messageId: string) {
  const { error } = await client.from("chat_messages").delete().eq("id", messageId);
  if (error) throw error;
}

export function titleFromMessage(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= 60) return normalized || "Nowa rozmowa";
  return `${normalized.slice(0, 57).trimEnd()}…`;
}

export function trimModelHistory<T extends { content: string }>(messages: T[]): T[] {
  const tail = messages.slice(-MODEL_HISTORY_MESSAGE_LIMIT);
  const selected: T[] = [];
  let remaining = MODEL_HISTORY_CHAR_LIMIT;

  for (let index = tail.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = tail[index];
    const content = message.content.slice(-remaining);
    if (!content) continue;
    selected.unshift({ ...message, content });
    remaining -= content.length;
  }

  return selected;
}
