import { describe, expect, it } from "vitest";

import { boundedJson, TYGODNIK_TOOLS, TYGODNIK_TOOL_NAMES } from "../lib/tygodnik/tools";

describe("Tygodnik tools", () => {
  it("exposes exactly three read-only contracts", () => {
    expect(TYGODNIK_TOOL_NAMES).toEqual([
      "search_tygodnik",
      "get_tygodnik_item",
      "get_latest_tygodnik",
    ]);
    expect(TYGODNIK_TOOLS).toHaveLength(3);
  });

  it("caps search and latest result counts in their schemas", () => {
    expect(TYGODNIK_TOOLS[0].schema.safeParse({ query: "budżet", limit: 7 }).success).toBe(false);
    expect(TYGODNIK_TOOLS[0].schema.safeParse({ query: "budżet", limit: 6 }).success).toBe(true);
    expect(TYGODNIK_TOOLS[2].schema.safeParse({ limit: 6 }).success).toBe(false);
    expect(TYGODNIK_TOOLS[2].schema.safeParse({ limit: 5 }).success).toBe(true);
  });

  it("always returns valid JSON within the token-saving output cap", () => {
    const output = boundedJson({ body: "x".repeat(10_000) }, 300);
    expect(output.length).toBeLessThanOrEqual(300);
    expect(JSON.parse(output)).toMatchObject({ truncated: true });
  });
});
