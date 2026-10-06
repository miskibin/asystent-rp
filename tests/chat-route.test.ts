import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ events: [] as unknown[], inserts: [] as { table: string; data: Record<string, unknown> }[], history: [] as unknown[], user: true }));
vi.mock("../lib/deepseek-agent", () => ({ streamDeepSeek: async function* (history: unknown[]) { state.history = history; for (const event of state.events) yield event; } }));
vi.mock("../lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user ? { id: "11111111-1111-4111-8111-111111111111" } : null } }) },
  from: (table: string) => {
    let operation = "select";
    let inserted: Record<string, unknown> = {};
    const result = () => {
      if (operation === "insert") return { data: table === "chat_threads" ? { id: "22222222-2222-4222-8222-222222222222", title: "Test", created_at: "now", updated_at: "now", pinned: false, sort_order: 0 } : { id: "33333333-3333-4333-8333-333333333333" }, error: null };
      if (operation === "update") return { data: null, error: null };
      const user = state.inserts.find((entry) => entry.table === "chat_messages" && entry.data.role === "user");
      return { data: user ? [{ id: "user", role: "user", content: user.data.content, process: user.data.process, message_order: 1 }] : [], error: null };
    };
    const builder = {
      insert(data: Record<string, unknown>) { operation = "insert"; inserted = data; state.inserts.push({ table, data: inserted }); return builder; },
      update() { operation = "update"; return builder; }, select() { return builder; }, eq() { return builder; }, order() { return builder; }, limit() { return Promise.resolve(result()); },
      single() { return Promise.resolve(result()); },
      then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
    };
    return builder;
  },
}) }));
import { POST } from "../app/api/chat/route";

beforeEach(() => { state.events = []; state.inserts = []; state.history = []; state.user = true; });
const request = (body: unknown) => new NextRequest("http://localhost/api/chat", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("chat route integration", () => {
  it("persists attachments separately while including their content in model history", async () => {
    state.events = [{ type: "text", content: "Odpowiedź" }];
    const response = await POST(request({ action: "send", content: "Wyjaśnij", documents: [{ name: "projekt.md", content: "Artykuł 1." }] }));
    await response.text();
    const storedUser = state.inserts.find((entry) => entry.data.role === "user");
    expect(storedUser?.data.content).toBe("Wyjaśnij");
    expect(storedUser?.data.process).toMatchObject({ documents: [{ name: "projekt.md", content: "Artykuł 1." }] });
    expect(state.history[0]).toMatchObject({ content: expect.stringContaining("Artykuł 1.") });
  });
  it("preserves question tool data and completion metadata across SSE and persistence", async () => {
    const input = JSON.stringify({ title: "Temat", questions: [{ id: "q", prompt: "Który?", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }] });
    state.events = [
      { type: "tool_start", id: "ask", name: "ask_question", input },
      { type: "tool_end", id: "ask", name: "ask_question", status: "done", output: '{"answers":{},"source":"agent"}' },
    ];
    const stream = await (await POST(request({ action: "send", content: "Pomóż" }))).text();
    expect(stream).toContain("Wybierz odpowiedzi");
    const storedAssistant = state.inserts.find((entry) => entry.data.role === "assistant");
    expect(storedAssistant?.data.process).toMatchObject({ parts: [{ type: "tool", tool: { name: "ask_question", input } }, { type: "text" }] });
  });
  it("grounds generated-document links in actual data-tool results and excludes presentation output as a source", async () => {
    state.events = [
      { type: "tool_start", id: "search", name: "search_sejm_data", input: "{}" },
      { type: "tool_end", id: "search", name: "search_sejm_data", status: "done", output: '{"items":[{"url":"https://sejm.gov.pl/valid"}]}' },
      { type: "tool_start", id: "doc", name: "draft_document", input: '{"title":"Pismo","content":"[Źródło](https://sejm.gov.pl/valid) [Błąd](https://fake.invalid/)"}' },
      { type: "tool_end", id: "doc", name: "draft_document", status: "done", output: "Gotowe." },
      { type: "text", content: "Gotowe." },
    ];
    const stream = await (await POST(request({ action: "send", content: "Pismo" }))).text();
    const storedAssistant = state.inserts.find((entry) => entry.data.role === "assistant");
    const process = storedAssistant?.data.process as { sources: string[]; parts: { type: string; tool?: { name: string; input: string } }[] };
    expect(process.sources).toEqual(["https://sejm.gov.pl/valid"]);
    expect(process.parts.find((part) => part.tool?.name === "draft_document")?.tool?.input).not.toContain("fake.invalid");
    expect(stream).toContain('"sources":["https://sejm.gov.pl/valid"]');
  });
  it("rejects unauthorized and invalid requests before changing stored conversations", async () => {
    expect((await POST(request({ action: "send", content: "x", documents: [{ name: "a.pdf", content: "binary" }] }))).status).toBe(400);
    state.user = false;
    expect((await POST(request({ action: "send", content: "x" }))).status).toBe(401);
    expect(state.inserts).toEqual([]);
  });
  it("finishes a tool-only plan as a successful answer", async () => {
    state.events = [
      { type: "tool_start", id: "plan", name: "create_plan", input: '{"title":"Plan","plan":"Sprawdź etap","todos":[]}' },
      { type: "tool_end", id: "plan", name: "create_plan", status: "done", output: "Plan przedstawiony." },
    ];
    const stream = await (await POST(request({ action: "send", content: "Przygotuj plan" }))).text();
    expect(stream).toContain("Wynik jest gotowy");
    expect(stream).toContain('"type":"done"');
    expect(stream).not.toContain("Nie udało się przygotować odpowiedzi");
  });
});
