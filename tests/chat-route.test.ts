import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ events: [] as unknown[], inserts: [] as { table: string; data: Record<string, unknown> }[], history: [] as unknown[], user: true }));
vi.mock("../lib/deepseek-chat", () => ({ streamDeepSeek: async function* (history: unknown[]) { state.history = history; for (const event of state.events) yield event; } }));
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
  it("grounds answer links in actual search results and persists sources", async () => {
    state.events = [
      { type: "tool_start", id: "search", name: "search_sejm_data", input: "{}" },
      { type: "tool_end", id: "search", name: "search_sejm_data", status: "done", output: '{"items":[{"url":"https://sejm.gov.pl/valid"}]}' },
      { type: "text", content: "[Źródło](https://sejm.gov.pl/valid) [Błąd](https://fake.invalid/)" },
    ];
    const stream = await (await POST(request({ action: "send", content: "Co uchwalono?", mode: "plan" }))).text();
    const storedAssistant = state.inserts.find((entry) => entry.data.role === "assistant");
    expect(storedAssistant?.data.content).toContain("https://sejm.gov.pl/valid");
    expect(storedAssistant?.data.content).not.toContain("fake.invalid");
    expect(storedAssistant?.data.process).toMatchObject({ sources: ["https://sejm.gov.pl/valid"] });
    expect(stream).toContain('"type":"done"');
    expect(stream).toContain('"sources":["https://sejm.gov.pl/valid"]');
  });
  it("rejects unauthorized and invalid requests before changing stored conversations", async () => {
    expect((await POST(request({ action: "send", content: "x", documents: [{ name: "a.pdf", content: "binary" }] }))).status).toBe(400);
    state.user = false;
    expect((await POST(request({ action: "send", content: "x" }))).status).toBe(401);
    expect(state.inserts).toEqual([]);
  });
  it("returns a plain fallback when the model produces no answer", async () => {
    const stream = await (await POST(request({ action: "send", content: "Pytanie" }))).text();
    expect(stream).toContain("Nie udało się przygotować odpowiedzi");
    expect(stream).toContain('"type":"done"');
    expect(state.inserts.find((entry) => entry.data.role === "assistant")?.data.content).toContain("dostępnych danych");
  });
});
