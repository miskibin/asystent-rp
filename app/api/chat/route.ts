import { NextRequest, NextResponse } from "next/server";
import { SystemMessage, ChatMessage } from "@langchain/core/messages";
import { createSejmStatsTool } from "@/tools/sejmstats";
import { convertRPMessageToLangChainMessage } from "@/lib/utils";
import { TogetherAPIError, TogetherLLM } from "@/lib/llms/TogetherLLm";
import { AgentRP } from "@/lib/agent";
import { generateUniqueId } from "@/utils/common";
import { PluginNames } from "@/lib/plugins";
import { createWikipediaTool } from "@/tools/wikipedia";
import { OpenAILLM } from "@/lib/llms/OpenAILLm";
import { AbstractLLM } from "@/lib/llms/LLM";
export const runtime = "edge";
export const dynamic = "force-dynamic";
const PLUGIN_MAPPING: Record<PluginNames, (model: TogetherLLM) => any> = {
  [PluginNames.SejmStats]: createSejmStatsTool,
  [PluginNames.Wikipedia]: createWikipediaTool,
};

const API_SECRET = process.env.API_SECRET || "default-secret-key";

function createLLM(modelName: string, options: any) {
  if (modelName.startsWith("gpt")) {
    return new OpenAILLM({
      apiKey: process.env.OPENAI_API_KEY!,
      model: modelName,
      ...options,
    });
  }

  return new TogetherLLM({
    apiKey: process.env.TOGETHER_API_KEY!,
    model: modelName,
    ...options,
  });
}
export async function POST(req: NextRequest) {
  try {
    // Validate API secret
    const apiToken = req.headers.get("x-api-secret");
    if (!apiToken || apiToken !== API_SECRET) {
      return NextResponse.json(
        { error: "Unauthorized access" },
        { status: 403 }
      );
    }

    // Validate referer
    const referer = req.headers.get("referer");
    const expectedReferer = `${req.nextUrl.protocol}//${req.nextUrl.host}`;

    if (!referer || !referer.startsWith(expectedReferer || "")) {
      return NextResponse.json(
        { error: "Unauthorized access" },
        { status: 403 }
      );
    }

    const { messages, systemPrompt, enabledPluginIds, modelName, options } =
      await req.json();

    // Create transform stream for chunked encoding
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();

    // Process messages in background
    (async () => {
      try {
        const llm = createLLM(modelName, options);
        const plugins = enabledPluginIds.map((id: PluginNames) =>
          PLUGIN_MAPPING[id](llm as TogetherLLM)
        );
        const agent = new AgentRP(llm as AbstractLLM, plugins);

        const langChainMessages: ChatMessage[] = [
          new ChatMessage({ role: "system", content: systemPrompt }),
          ...messages.map(convertRPMessageToLangChainMessage),
        ];

        for await (const progress of agent.invoke(langChainMessages)) {
          const response = {
            type: progress.type,
            messages: [
              {
                id: generateUniqueId(),
                role: "assistant" as const,
                content: progress.content,
                artifacts: progress.artifacts || [],
                data: progress.data || [],
              },
            ],
          };

          await writer.write(
            encoder.encode(`data: ${JSON.stringify(response)}\n\n`)
          );
        }
      } catch (error) {
        // Handle errors within the stream
        const errorMessage = {
          type: "error",
          error:
            error instanceof TogetherAPIError
              ? `API Error: ${error.message}${
                  error.statusCode ? ` (Status: ${error.statusCode})` : ""
                }`
              : error instanceof Error
              ? error.message
              : "An unexpected error occurred",
        };

        await writer.write(
          encoder.encode(`data: ${JSON.stringify(errorMessage)}\n\n`)
        );
      } finally {
        await writer.close();
      }
    })();

    // Return the stream with proper headers for Edge runtime
    return new Response(stream.readable, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("Error in POST handler:", error);
    return NextResponse.json(
      {
        error:
          error instanceof TogetherAPIError
            ? `API Error: ${error.message}`
            : "Internal server error",
      },
      {
        status:
          error instanceof TogetherAPIError ? error.statusCode || 500 : 500,
      }
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: "OK" });
}
