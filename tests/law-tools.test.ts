import { afterEach, describe, expect, it, vi } from "vitest";
import { LAW_DATA_TOOLS, legalToolJson, readLaw } from "../lib/tygodnik/law-tools";
import { lawDraft, lawHandoffQuery } from "../lib/law-handoff";

afterEach(() => vi.unstubAllGlobals());

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
