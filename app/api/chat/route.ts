import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { streamDeepSeek } from "@/lib/deepseek-agent";
import { titleFromMessage, trimModelHistory, USER_MESSAGE_CHAR_LIMIT } from "@/lib/chat-persistence";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Message } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const chatRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), threadId: z.string().uuid().optional(), content: z.string().trim().min(1).max(USER_MESSAGE_CHAR_LIMIT) }),
  z.object({ action: z.literal("edit"), threadId: z.string().uuid(), messageId: z.string().uuid(), content: z.string().trim().min(1).max(USER_MESSAGE_CHAR_LIMIT) }),
  z.object({ action: z.literal("regenerate"), threadId: z.string().uuid(), messageId: z.string().uuid() }),
]);

type Supabase = Awaited<ReturnType<typeof createServerSupabaseClient>>;
type ChatAction = z.infer<typeof chatRequestSchema>;
type ThreadRow = { id: string; title: string; created_at: string; updated_at: string };
type MessageRow = { id: string; role: "user" | "assistant"; content: string; message_order: number };

function sse(data: unknown, eventId: string) {
  return `id: ${eventId}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function ownedThread(supabase: Supabase, threadId: string): Promise<ThreadRow> {
  const { data, error } = await supabase.from("chat_threads").select("id,title,created_at,updated_at").eq("id", threadId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Rozmowa nie istnieje lub nie masz do niej dostępu.");
  return data as ThreadRow;
}

async function prepareChatRun(supabase: Supabase, userId: string, action: ChatAction): Promise<{ thread: ThreadRow; userMessageId: string | null; history: Message[] }> {
  let thread: ThreadRow;
  let userMessageId: string | null = null;

  if (action.action === "send" && !action.threadId) {
    const { data, error } = await supabase.from("chat_threads").insert({ user_id: userId, title: titleFromMessage(action.content) }).select("id,title,created_at,updated_at").single();
    if (error) throw error;
    thread = data as ThreadRow;
  } else {
    thread = await ownedThread(supabase, action.threadId as string);
  }

  if (action.action === "send") {
    const { data, error } = await supabase.from("chat_messages").insert({ thread_id: thread.id, user_id: userId, role: "user", content: action.content }).select("id").single();
    if (error) throw error;
    userMessageId = data.id as string;
  } else {
    const expectedRole = action.action === "edit" ? "user" : "assistant";
    const { data: target, error: targetError } = await supabase.from("chat_messages").select("id,role,message_order").eq("id", action.messageId).eq("thread_id", thread.id).maybeSingle();
    if (targetError) throw targetError;
    if (!target || target.role !== expectedRole) throw new Error("Nieprawidłowa wiadomość rozmowy.");

    const deleteQuery = supabase.from("chat_messages").delete().eq("thread_id", thread.id);
    const { error: deleteError } = action.action === "edit" ? await deleteQuery.gt("message_order", target.message_order) : await deleteQuery.gte("message_order", target.message_order);
    if (deleteError) throw deleteError;

    if (action.action === "edit") {
      const { error } = await supabase.from("chat_messages").update({ content: action.content }).eq("id", action.messageId).eq("thread_id", thread.id);
      if (error) throw error;
      userMessageId = action.messageId;
    }
  }

  const now = new Date().toISOString();
  const { error: touchError } = await supabase.from("chat_threads").update({ updated_at: now }).eq("id", thread.id);
  if (touchError) throw touchError;
  thread = { ...thread, updated_at: now };

  const { data: rows, error: historyError } = await supabase.from("chat_messages").select("id,role,content,message_order").eq("thread_id", thread.id).order("message_order", { ascending: false }).limit(12);
  if (historyError) throw historyError;
  const history = trimModelHistory(((rows ?? []) as MessageRow[]).reverse().map(({ id, role, content }) => ({ id, role, content })));
  return { thread, userMessageId, history };
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid chat request" }, { status: 400 }); }
  const parsed = chatRequestSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Invalid chat request" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let connected = true;
      let assistantContent = "";
      let prepared: Awaited<ReturnType<typeof prepareChatRun>> | null = null;
      let assistantPersistAttempted = false;
      let sequence = 0;
      const push = (event: unknown, eventId: string) => {
        if (!connected) return;
        try { controller.enqueue(encoder.encode(sse(event, eventId))); } catch { connected = false; }
      };
      const persistAssistant = async () => {
        if (!prepared || !assistantContent.trim() || assistantPersistAttempted) return null;
        assistantPersistAttempted = true;
        const { data: assistant, error } = await supabase.from("chat_messages").insert({ thread_id: prepared.thread.id, user_id: data.user.id, role: "assistant", content: assistantContent }).select("id").single();
        if (error) throw error;
        return assistant.id as string;
      };

      try {
        prepared = await prepareChatRun(supabase, data.user.id, parsed.data);
        push({ type: "thread", threadId: prepared.thread.id, thread: prepared.thread, userMessageId: prepared.userMessageId }, `${prepared.thread.id}:thread`);

        for await (const content of streamDeepSeek(prepared.history, request.signal)) {
          assistantContent += content;
          push({ type: "response", threadId: prepared.thread.id, messages: [{ role: "assistant", content }] }, `${prepared.thread.id}:response:${sequence++}`);
        }

        const assistantMessageId = await persistAssistant();
        if (assistantMessageId) {
          push({ type: "done", threadId: prepared.thread.id, assistantMessageId }, `${prepared.thread.id}:done`);
        }
      } catch (error) {
        if (assistantContent.trim() && !assistantPersistAttempted) {
          try {
            const assistantMessageId = await persistAssistant();
            if (assistantMessageId && prepared) {
              console.warn("Agent stopped after returning a partial response", error);
              push({ type: "done", threadId: prepared.thread.id, assistantMessageId }, `${prepared.thread.id}:done`);
              return;
            }
          } catch (persistError) {
            console.error("Partial assistant response was not persisted", persistError);
          }
        }
        if (!(error instanceof Error && error.name === "AbortError")) {
          console.error("DeepSeek chat failed", error);
          push({ type: "error", threadId: prepared?.thread.id, messages: [{ role: "assistant", content: "Nie udało się uzyskać odpowiedzi." }] }, `${prepared?.thread.id ?? "chat"}:error`);
        }
      } finally {
        if (connected) controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Cache-Control": "no-cache, no-transform", "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}

export async function GET() {
  return NextResponse.json({ model: "DeepSeek V4 Flash", status: "ok" });
}
