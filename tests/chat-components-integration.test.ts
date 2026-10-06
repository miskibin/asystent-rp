import { describe, expect, it } from "vitest";
import { AIMessageChunk, ToolMessage } from "@langchain/core/messages";
import { chatRequestSchema, documentsSchema, expandTaskPrompt } from "../lib/chat-request";
import { filesFromMessages, exportConversation } from "../lib/chat-files";
import { streamAgentEvents, toLangChainMessages } from "../lib/deepseek-agent";
import { collectHttpUrlsFromToolOutput } from "../lib/grounded-response";
import { StreamProcessor } from "../hooks/streamProcessor";
import type { Message } from "../lib/types";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
describe("chat-components integration", () => {
  it("validates the server boundary for document sizes, binary content and supported types", () => {
    expect(documentsSchema.safeParse([{ name: "ustawa.md", content: "# Projekt" }]).success).toBe(true);
    for (const documents of [
      [{ name: "plik.pdf", content: "binary" }],
      [{ name: "plik.txt", content: "\0" }],
      [{ name: "plik.txt", content: "x".repeat(12_001) }],
      [{ name: "a.txt", content: "x".repeat(7_000) }, { name: "b.txt", content: "x".repeat(7_000) }],
      Array.from({ length: 4 }, (_, n) => ({ name: `${n}.txt`, content: "x" })),
    ]) expect(documentsSchema.safeParse(documents).success).toBe(false);
    expect(chatRequestSchema.safeParse({ action: "send", content: "Pytanie", mode: "plan" }).success).toBe(true);
    expect(chatRequestSchema.safeParse({ action: "send", content: "Pytanie", mode: "terminal" }).success).toBe(false);
  });

  it("expands registered commands and skills without mangling ordinary text", () => {
    expect(expandTaskPrompt("/podsumuj projekt")).toContain("Podsumuj najważniejsze fakty");
    expect(expandTaskPrompt("$pismo przygotuj wniosek")).toContain("wersję roboczą pisma");
    expect(expandTaskPrompt("/posiedzenie")).toContain("ostatnim posiedzeniu");
    expect(expandTaskPrompt("Cena $100 i ścieżka /plik")).toBe("Cena $100 i ścieżka /plik");
  });

  it("passes document text to the model without adding artificial assistant reasoning", () => {
    const messages = toLangChainMessages([{ id: "u", role: "user", content: "Wyjaśnij", documents: [{ name: "wniosek.md", content: "Treść wniosku" }] }]);
    expect(messages[0].content).toContain("Treść wniosku");
    expect(messages[0].content).toContain("wniosek.md");
  });

  it("keeps consecutive model rounds' tool calls distinct when their chunk indexes reset", async () => {
    async function* chunks() {
      yield new AIMessageChunk({ content: "", tool_call_chunks: [{ id: "first", name: "search_sejm_data", args: '{"query":"A"}', index: 0 }] });
      yield new ToolMessage({ content: "{}", tool_call_id: "first", name: "search_sejm_data" });
      yield new AIMessageChunk({ content: "", tool_call_chunks: [{ id: "second", name: "get_sejm_record", args: '{"id":"B"}', index: 0 }] });
    }
    const events = [];
    for await (const event of streamAgentEvents(chunks())) events.push(event);
    expect(events.filter((event) => event.type === "tool_start").map((event) => event.id)).toEqual(["first", "second"]);
    expect(events.at(-1)).toMatchObject({ name: "get_sejm_record", input: '{"id":"B"}' });
  });

  it("decodes fragmented SSE with Polish text, chronological tool updates, sources and persisted message IDs", async () => {
    let latest: Message | undefined;
    let persisted = "";
    const errors: unknown[] = [];
    const processor = new StreamProcessor((_id, message) => { latest = message; }, () => {}, (error) => errors.push(error), undefined, (event) => { persisted = event.assistantMessageId; });
    const frames = [
      { type: "tool_start", tool: { id: "t", name: "ask_question", status: "running", input: '{"questions":[]}' } },
      { type: "tool_end", tool: { id: "t", name: "ask_question", status: "done", output: '{"answers":{}}' } },
      { type: "response", messages: [{ role: "assistant", content: "Zażółć gęślą jaźń" }] },
      { type: "done", threadId: THREAD_ID, assistantMessageId: "stored", workedFor: 4, sources: ["https://tygodniksejmowy.pl/"] },
    ];
    const bytes = new TextEncoder().encode(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""));
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3)); controller.close(); } });
    await processor.processStream(stream.getReader(), "local");
    expect(errors).toEqual([]);
    expect(latest).toMatchObject({ content: "Zażółć gęślą jaźń", workedFor: 4, sources: ["https://tygodniksejmowy.pl/"] });
    expect(latest?.parts?.map((part) => part.type)).toEqual(["tool", "text"]);
    expect(persisted).toBe("stored");
  });

  it("extracts only completed documents and exports their content and grounded sources", () => {
    const messages: Message[] = [
      { id: "u", role: "user", content: "Wyjaśnij", documents: [{ name: "tekst.md", content: "Dokument" }] },
      { id: "a", role: "assistant", content: "Odpowiedź", sources: ["https://tygodniksejmowy.pl/"], parts: [
        { type: "tool", id: "part", tool: { id: "draft", name: "draft_document", status: "done", input: JSON.stringify({ title: "Pismo", content: "Treść pisma" }) } },
        { type: "tool", id: "incomplete", tool: { id: "pending", name: "draft_document", status: "running", input: "{" } },
      ] },
    ];
    expect(filesFromMessages(messages)).toHaveLength(2);
    const exported = exportConversation(messages, "Rozmowa");
    expect(exported).toContain("Treść pisma");
    expect(exported).toContain("https://tygodniksejmowy.pl/");
    expect(collectHttpUrlsFromToolOutput('{"url":"javascript:alert(1)","source":"https://sejm.gov.pl/"}')).toEqual(new Set(["https://sejm.gov.pl"]));
  });
});
