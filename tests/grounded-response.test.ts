import { describe, expect, it } from "vitest";

import {
  collectHttpUrlsFromToolOutput,
  displayToolName,
  keepOnlyGroundedLinks,
  summarizeToolOutput,
} from "../lib/grounded-response";

describe("grounded assistant output", () => {
  it("keeps exact tool URLs and removes invented destinations", () => {
    const allowed = collectHttpUrlsFromToolOutput(
      JSON.stringify({ url: "https://tygodniksejmowy.pl/glosowanie/123" })
    );
    const answer = keepOnlyGroundedLinks(
      [
        "[Prawidłowy link](https://tygodniksejmowy.pl/glosowanie/123)",
        "[Zmyślony link](https://tygodniksejmowy.pl/glosowanie/10/64/35)",
      ].join("\n"),
      allowed
    );

    expect(answer).toContain(
      "[Prawidłowy link](https://tygodniksejmowy.pl/glosowanie/123)"
    );
    expect(answer).toContain("Zmyślony link");
    expect(answer).not.toContain("/glosowanie/10/64/35");
  });

  it("uses self-explanatory labels and compact results", () => {
    expect(displayToolName("get_latest_sejm_sitting")).toBe(
      "Sprawdzanie ostatniego posiedzenia Sejmu"
    );
    expect(displayToolName("search_sejm_data")).not.toContain("Tygodnik");
    expect(
      summarizeToolOutput("get_latest_sejm_sitting", JSON.stringify({ items: [{}, {}] }))
    ).toBe("Pobrano 2 wydarzenia.");
  });
});