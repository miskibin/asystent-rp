import { describe, expect, it } from "vitest";
import { AIMessageChunk, ToolMessage } from "@langchain/core/messages";

import {
  boundedJson,
  buildSearchQueries,
  formatLatestEvent,
  parsePrintKey,
  SEJM_DATA_TOOLS,
  SEJM_DATA_TOOL_NAMES,
} from "../lib/tygodnik/tools";
import { streamAgentEvents } from "../lib/deepseek-agent";

describe("Tygodnik tools", () => {
  it("exposes exactly three read-only contracts", () => {
    expect(SEJM_DATA_TOOL_NAMES).toEqual([
      "search_sejm_data",
      "get_sejm_record",
      "get_latest_sejm_sitting",
    ]);
    expect(SEJM_DATA_TOOLS).toHaveLength(3);
  });

  it("caps search and latest result counts in their schemas", () => {
    expect(SEJM_DATA_TOOLS[0].schema.safeParse({ query: "budżet", limit: 9 }).success).toBe(false);
    expect(SEJM_DATA_TOOLS[0].schema.safeParse({ query: "budżet", limit: 8 }).success).toBe(true);
    expect(SEJM_DATA_TOOLS[2].schema.safeParse({ limit: 11 }).success).toBe(false);
    expect(SEJM_DATA_TOOLS[2].schema.safeParse({ limit: 10 }).success).toBe(true);
  });

  it("turns a natural-language question into bounded Polish search fallbacks", () => {
    expect(buildSearchQueries("Jakie ustawy dotyczą ochrony zdrowia?")).toEqual([
      "ustawy dotyczą ochrony zdrowia",
      "ustawy",
      "dotyczą",
      "ochrony",
    ]);
  });

  it("supports current and legacy print identifiers from production search", () => {
    expect(parsePrintKey("10:719")).toEqual({ term: 10, number: "719" });
    expect(parsePrintKey("719")).toEqual({ term: null, number: "719" });
  });
  it("always returns valid JSON within the token-saving output cap", () => {
    const output = boundedJson({ body: "x".repeat(10_000) }, 300);
    expect(output.length).toBeLessThanOrEqual(300);
    expect(JSON.parse(output)).toMatchObject({ truncated: true });
  });

  it("turns a ranked vote row into user-facing facts and a canonical link", () => {
    const event = formatLatestEvent(
      {
        event_type: "vote",
        event_date: "2026-09-04",
        source_url: "/glosowanie/10/64/35",
        payload: {
          voting_id: 123,
          title: "Głosowanie nad ustawą",
          yes: 231,
          no: 210,
          abstain: 4,
          not_participating: 15,
        },
      },
      10
    );

    expect(event).toMatchObject({
      kind: "voting",
      id: "123",
      result: { yes: 231, no: 210, abstain: 4 },
      url: "https://tygodniksejmowy.pl/glosowanie/123",
    });
    expect(JSON.stringify(event)).not.toContain("impact");
    expect(JSON.stringify(event)).not.toContain("/10/64/35");
  });

  it("exposes model text, tool start and tool completion from LangChain messages", async () => {
    async function* chunks() {
      yield [
        new AIMessageChunk({
          content: "Sprawdzę.",
          tool_call_chunks: [
            {
              id: "call-1",
              name: "get_latest_sejm_sitting",
              args: '{"limit":',
              index: 0,
            },
          ],
        }),
        {},
      ];
      yield new AIMessageChunk({
        content: "",
        tool_call_chunks: [{ args: "5}", index: 0 }],
      });
      yield new ToolMessage({
        content: '{"items":[{"url":"https://tygodniksejmowy.pl/glosowanie/123"}]}',
        tool_call_id: "call-1",
        name: "get_latest_sejm_sitting",
      });
    }

    const events = [];
    for await (const event of streamAgentEvents(chunks())) events.push(event);

    expect(events).toEqual([
      { type: "text", content: "Sprawdzę." },
      {
        type: "tool_start",
        id: "call-1",
        name: "get_latest_sejm_sitting",
        input: '{"limit":',
      },
      {
        type: "tool_update",
        id: "call-1",
        name: "get_latest_sejm_sitting",
        input: '{"limit":5}',
      },
      {
        type: "tool_end",
        id: "call-1",
        name: "get_latest_sejm_sitting",
        output: '{"items":[{"url":"https://tygodniksejmowy.pl/glosowanie/123"}]}',
        status: "done",
      },
    ]);
  });
});