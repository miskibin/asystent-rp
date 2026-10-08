import { describe, expect, it } from "vitest";
import { presentChatMessage } from "../lib/chat-presentation";
import type { Message } from "../lib/types";

describe("retrieval trace presentation", () => {
  it("keeps chronological text and real tool steps, including persisted localized names", () => {
    const message: Message = { id: "a", role: "assistant", content: "Wynik", workedFor: 3, parts: [
      { type: "tool", id: "p", tool: { id: "search", name: "Wyszukiwanie w danych Sejmu", status: "done" } },
      { type: "text", id: "answer", text: "Wynik" },
    ] };
    expect(presentChatMessage(message)).toMatchObject({ parts: message.parts, workedFor: 3, content: "Wynik" });
  });

  it("retains the answer on old tool-only records and hides historical UI tools and reasoning", () => {
    const result = presentChatMessage({ id: "a", role: "assistant", content: "Odpowiedź", parts: [
      { type: "thinking", id: "reason", text: "Private reasoning" },
      { type: "tool", id: "plan", tool: { id: "plan", name: "create_plan" } },
      { type: "tool", id: "search", tool: { id: "search", name: "search_sejm_data", status: "done" } },
    ] });
    expect(result.parts?.map((part) => part.type)).toEqual(["tool", "text"]);
    expect(result.parts?.at(-1)).toMatchObject({ text: "Odpowiedź" });
    expect(JSON.stringify(result)).not.toMatch(/Private reasoning|create_plan/);
  });

  it("shows running steps live and settles unfinished steps when generation stops", () => {
    const message: Message = { id: "a", role: "assistant", content: "", tools: [{ id: "t", name: "get_legal_provision", status: "running" }] };
    expect(presentChatMessage(message, true).parts?.[0]).toMatchObject({ tool: { status: "running" } });
    expect(presentChatMessage(message, false).parts?.[0]).toMatchObject({ tool: { status: "error", output: "Działanie zostało przerwane." } });
    expect(message.tools?.[0].status).toBe("running");
  });

  it("does not create a trace for a plain answer or a user message", () => {
    expect(presentChatMessage({ id: "a", role: "assistant", content: "Odpowiedź" }).parts).toBeUndefined();
    expect(presentChatMessage({ id: "u", role: "user", content: "Pytanie", tools: [{ id: "t", name: "search_sejm_data" }] }).parts).toBeUndefined();
  });
});
