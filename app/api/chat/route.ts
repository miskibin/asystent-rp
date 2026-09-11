import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { streamDeepSeek } from "@/lib/deepseek-agent";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Message } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(20_000),
      })
    )
    .min(1)
    .max(100),
});

function sse(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = chatRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid chat request" }, { status: 400 });
  }

  const messages = parsed.data.messages as Message[];
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const content of streamDeepSeek(messages)) {
          controller.enqueue(
            encoder.encode(
              sse({
                type: "response",
                messages: [{ role: "assistant", content }],
              })
            )
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Assistant failed to respond";
        controller.enqueue(
          encoder.encode(
            sse({
              type: "error",
              messages: [{ role: "assistant", content: message }],
            })
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET() {
  return NextResponse.json({ model: "DeepSeek V4 Flash", status: "ok" });
}
