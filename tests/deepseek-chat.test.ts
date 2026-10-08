import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AIMessage, AIMessageChunk, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
const state = vi.hoisted(() => ({ invoke: vi.fn(), lawInvoke: vi.fn() }));
vi.mock("../lib/tygodnik/tools", () => ({ SEJM_DATA_TOOLS: [{ name: "search_sejm_data", invoke: state.invoke }] }));
vi.mock("../lib/tygodnik/law-tools", async (importOriginal) => ({ ...await importOriginal<object>(), LAW_DATA_TOOLS: [{ name: "search_legal_provisions", invoke: state.lawInvoke }] }));
import { createDeepSeekModel, streamDeepSeek, toLangChainMessages } from "../lib/deepseek-chat";

const question = [{ id: "u", role: "user" as const, content: "Co uchwalono?" }];
function search(id: string, name = "search_sejm_data") {
  return new AIMessageChunk({ content: "", tool_call_chunks: [{ id, name, args: '{"query":"ustawa"}', index: 0 }] });
}
function mockModel(rounds: AIMessageChunk[][]) {
  const histories: BaseMessage[][] = [];
  const next = async (history: BaseMessage[]) => {
    histories.push([...history]);
    const chunks = rounds.shift() ?? [];
    return (async function* () { yield* chunks; })();
  };
  const bound = vi.fn(next), unbound = vi.fn(next);
  vi.spyOn(ChatOpenAI.prototype, "bindTools").mockReturnValue({ stream: bound } as never);
  vi.spyOn(ChatOpenAI.prototype, "stream").mockImplementation(unbound as never);
  return { histories, bound, unbound };
}
async function events(signal?: AbortSignal) {
  const result = [];
  for await (const event of streamDeepSeek(question, signal)) result.push(event);
  return result;
}
beforeEach(() => { process.env.DEEPSEEK_API_KEY = "test-key"; state.invoke.mockReset().mockResolvedValue('{"items":[{"url":"https://sejm.gov.pl/"}]}'); });
afterEach(() => { vi.restoreAllMocks(); });

describe("simple DeepSeek chat", () => {
  it("refuses unverified law before another model call can invent applicability", async () => {
    const model = mockModel([[search("law", "search_legal_provisions")], [new AIMessageChunk("To na pewno obowiązuje.")]]);
    state.lawInvoke.mockResolvedValue(JSON.stringify({ answerable: false, context_complete: false, items: [{ label: "Art. 27", url: "https://tygodniksejmowy.pl/prawo/DU/2014/827#art-27" }] }));
    const result = await events();
    expect(model.bound).toHaveBeenCalledTimes(1);
    expect(result.at(-1)).toMatchObject({ type: "text", content: expect.stringContaining("Nie mogę potwierdzić") });
    expect(JSON.stringify(result)).not.toContain("na pewno obowiązuje");
  });
  it("answers law from a qualified version and complete context", async () => {
    const model = mockModel([[search("law", "search_legal_provisions")], [new AIMessageChunk("Odpowiedź oparta na potwierdzonej wersji.")]]);
    state.lawInvoke.mockResolvedValue(JSON.stringify({ answerable: true, context_complete: true }));
    expect((await events()).at(-1)).toMatchObject({ content: "Odpowiedź oparta na potwierdzonej wersji." });
    expect(model.bound).toHaveBeenCalledTimes(2);
  });
  it("streams an ordinary answer without calling retrieval", async () => {
    const model = mockModel([[new AIMessageChunk("Cześć!")]]);
    expect(await events()).toEqual([{ type: "text", content: "Cześć!" }]);
    expect(state.invoke).not.toHaveBeenCalled();
    expect(model.bound).toHaveBeenCalledTimes(1);
  });
  it("passes validated search results back to the model before answering", async () => {
    const model = mockModel([[search("s")], [new AIMessageChunk("Uchwalono ustawę.")]]);
    const result = await events();
    expect(state.invoke).toHaveBeenCalledWith({ query: "ustawa" }, { signal: undefined });
    expect(model.histories[1].at(-1)).toBeInstanceOf(ToolMessage);
    expect(model.histories[1].at(-1)?.content).toContain("https://sejm.gov.pl/");
    expect(result.at(-1)).toEqual({ type: "text", content: "Uchwalono ustawę." });
  });
  it("never executes an unavailable plan or system tool", async () => {
    const model = mockModel([[search("p", "create_plan")], [new AIMessageChunk("Wyjaśnię to w rozmowie.")]]);
    const result = await events();
    expect(state.invoke).not.toHaveBeenCalled();
    expect(result).toContainEqual(expect.objectContaining({ type: "tool_end", status: "error", name: "create_plan" }));
    expect(model.histories[1].at(-1)?.content).toContain("nie jest dostępne");
  });
  it("bounds retrieval calls and makes the final answer without tools", async () => {
    const model = mockModel([...[1, 2, 3, 4].map((id) => [search(String(id))]), [new AIMessageChunk("Odpowiedź na podstawie danych.")]]);
    expect((await events()).at(-1)).toMatchObject({ type: "text" });
    expect(state.invoke).toHaveBeenCalledTimes(4);
    expect(model.bound).toHaveBeenCalledTimes(4);
    expect(model.unbound).toHaveBeenCalledTimes(1);
  });
  it("stops after an abort during retrieval", async () => {
    const controller = new AbortController();
    const model = mockModel([[search("s")], [new AIMessageChunk("Nie powinno dotrzeć.")]]);
    state.invoke.mockImplementation(async () => { controller.abort(); return "{}"; });
    await expect(events(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(model.bound).toHaveBeenCalledTimes(1);
  });
  it("lets the model explain unavailable data after retrieval fails", async () => {
    mockModel([[search("s")], [new AIMessageChunk("Nie udało się potwierdzić danych.")]]);
    state.invoke.mockRejectedValue(new Error("Query failed"));
    const result = await events();
    expect(result).toContainEqual(expect.objectContaining({ type: "tool_end", status: "error" }));
    expect(result.at(-1)).toMatchObject({ content: "Nie udało się potwierdzić danych." });
  });
  it("uses the configured model with thinking disabled and ordinary message history", () => {
    expect(createDeepSeekModel()).toMatchObject({ model: "deepseek-v4-flash", maxTokens: 1_800, modelKwargs: { thinking: { type: "disabled" } } });
    const converted = toLangChainMessages([...question, { id: "a", role: "assistant", content: "Hej" }, { id: "s", role: "system", content: "Nieufny prompt" }]);
    expect(converted).toHaveLength(2);
    expect(converted[0]).toBeInstanceOf(HumanMessage);
    expect(converted[1]).toBeInstanceOf(AIMessage);
  });
});
