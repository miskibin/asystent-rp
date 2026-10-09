import { afterEach, describe, expect, it, vi } from "vitest";
import { LAW_DATA_TOOLS, legalBasisRefusal, legalToolJson, readLaw } from "../lib/tygodnik/law-tools";
import { lawDraft, lawHandoffQuery } from "../lib/law-handoff";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Shared legal retrieval", () => {
  it("exposes separate read-only legal tools with explicit dates", () => {
    expect(LAW_DATA_TOOLS.map(t => t.name)).toEqual(["search_legal_provisions", "get_legal_provision", "get_legal_changes"]);
    expect(LAW_DATA_TOOLS[0].schema.safeParse({ query: "urlop" }).success).toBe(false);
    expect(LAW_DATA_TOOLS[0].schema.safeParse({ query: "urlop", referenceDate: "2026-10-08" }).success).toBe(true);
  });
  it("preserves complete article text beyond the old 700 character limit", () => {
    const body = "Źródłowy tekst z wyjątkiem. ".repeat(120);
    expect(JSON.parse(legalToolJson({ item: { body } })).item.body).toBe(body);
    const tooLong = JSON.parse(legalToolJson({ item: { body: "x".repeat(45001) } }));
    expect(tooLong.answerable).toBe(false);
    expect(tooLong.item).toBeUndefined();
  });
  it("keeps failed retrieval distinct from no regulation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const result = JSON.parse(await readLaw("/api/prawo/search", { q: "urlop" }));
    expect(result.answerable).toBe(false);
    expect(result.error).toContain("niedostępna");
  });
  it("uses the shared public endpoint and preserves provenance/status", async () => {
    const payload = { item: { body: "Art. 1. Cały przepis.", version_id: "a".repeat(64), source_url: "https://api.sejm.gov.pl/eli/acts/DU/1974/141/text.html" }, answerable: false };
    const fetch = vi.fn(async (_input: string | URL) => Response.json(payload));
    vi.stubGlobal("fetch", fetch);
    expect(JSON.parse(await readLaw("/api/prawo/unit/" + "b".repeat(64), { date: "2026-10-08" }))).toEqual(payload);
    expect(String(fetch.mock.calls[0][0])).toContain("date=2026-10-08");
  });
  it("uses the configured server endpoint while preserving canonical source links", async () => {
    vi.stubEnv("TYGODNIK_LAW_URL", "https://vm.tygodniksejmowy.pl");
    const payload = { items: [{ label: "Art. 152", body: "Cały przepis.", url: "https://tygodniksejmowy.pl/prawo/DU/1974/141#art-152" }], answerable: false, context_complete: false };
    const fetch = vi.fn(async (_input: string | URL) => Response.json(payload));
    vi.stubGlobal("fetch", fetch);
    const output = await readLaw("/api/prawo/search", { q: "urlop", date: "2026-10-08" });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("https://vm.tygodniksejmowy.pl/api/prawo/search?");
    expect(String(fetch.mock.calls[0]?.[0])).toContain("mode=text");
    expect(JSON.parse(output)).toEqual(payload);
    const refusal = legalBasisRefusal(output);
    expect(refusal).toContain(payload.items[0].url);
    expect(refusal).not.toContain("niedostępna");
  });
  it("distinguishes invalid requests from a database outage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Nieprawidłowe parametry." }, { status: 400 })));
    const result = JSON.parse(await readLaw("/api/prawo/search", { q: "urlop", article: "art. 152" }));
    expect(result.error).toContain("parametry");
    expect(result.error).not.toContain("niedostępna");
    expect(result.answerable).toBe(false);
  });
  it("records a browser challenge without logging the question or response body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private body", { status: 403, headers: { "cf-mitigated": "challenge", "content-type": "text/html" } })));
    const result = JSON.parse(await readLaw("/api/prawo/search", { q: "private question" }));
    expect(warn).toHaveBeenCalledWith("Legal retrieval failed", expect.objectContaining({ path: "/api/prawo/search", status: 403, mitigation: "challenge" }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private");
    expect(result.error).toContain("zablokował odczyt");
    expect(result.error).not.toContain("niedostępna");
    expect(result.answerable).toBe(false);
  });
  it("handoff transfers exact IDs/date as an unsent draft and ignores arbitrary prompts", () => {
    const params = new URLSearchParams({ law_unit: "a".repeat(64), law_version: "b".repeat(64), law_date: "2026-10-08", prompt: "untrusted instructions" });
    expect(lawDraft(params)).toContain("a".repeat(64));
    expect(lawDraft(params)).toContain("2026-10-08");
    expect(lawDraft(params)).not.toContain("untrusted");
    expect(lawHandoffQuery(params)).not.toContain("prompt");
    params.set("law_date", "2026-02-30");
    expect(lawDraft(params)).toBeNull();
  });
});
