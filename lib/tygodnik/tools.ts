import { tool } from "langchain";
import { z } from "zod";

import { createTygodnikClient } from "./client";

const SITE_URL = "https://tygodniksejmowy.pl";
const kinds = ["print", "promise", "statement", "voting", "committee", "mp"] as const;
type TygodnikKind = (typeof kinds)[number];
type JsonRecord = Record<string, unknown>;

type SearchRow = {
  kind: TygodnikKind;
  entity_id: string;
  rank: number;
  headline: string | null;
};

export type LatestEventRow = {
  event_type: string;
  event_date: string | null;
  payload: unknown;
  source_url: string | null;
};

function cleanText(value: unknown, max = 700): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compact(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return cleanText(value);
  if (depth >= 3) return undefined;
  if (Array.isArray(value)) return value.slice(0, 8).map((entry) => compact(entry, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [key, compact(entry, depth + 1)] as const)
        .filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
    );
  }
  return undefined;
}

export function boundedJson(value: unknown, max = 2_500): string {
  const text = JSON.stringify(compact(value));
  if (text.length <= max) return text;
  let preview = text;
  while (preview.length > 0 && JSON.stringify({ truncated: true, preview }).length > max) {
    preview = preview.slice(0, -64);
  }
  return JSON.stringify({ truncated: true, preview });
}

function unavailable(error: unknown): string {
  console.error("Tygodnik data tool failed", error);
  return boundedJson({ error: "Dane są chwilowo niedostępne." }, 300);
}

function appUrl(path: string): string {
  return `${SITE_URL}${path}`;
}

function trustedExternalUrl(value: unknown): string | null {
  const text = cleanText(value, 600);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function printKey(entityId: string): { term: number; number: string } | null {
  const [rawTerm, ...numberParts] = entityId.split(":");
  const term = Number(rawTerm);
  const number = numberParts.join(":");
  return Number.isFinite(term) && number ? { term, number } : null;
}

function linkedPrints(value: unknown, term: number) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).flatMap((entry) => {
    const item = record(entry);
    const number = cleanText(item.number, 40);
    if (!number) return [];
    return [{
      number,
      title: cleanText(item.short_title, 220),
      url: appUrl(`/proces/${term}/${encodeURIComponent(number)}`),
    }];
  });
}

export function formatLatestEvent(row: LatestEventRow, term: number) {
  const payload = record(row.payload);
  const date = cleanText(row.event_date, 40);

  if (row.event_type === "vote") {
    const id = finiteNumber(payload.voting_id);
    if (id == null) return null;
    return {
      kind: "voting",
      id: String(id),
      date,
      title: cleanText(payload.title, 260) ?? cleanText(payload.topic, 260) ?? "Głosowanie",
      topic: cleanText(payload.topic, 500),
      result: {
        yes: finiteNumber(payload.yes),
        no: finiteNumber(payload.no),
        abstain: finiteNumber(payload.abstain),
        notParticipating: finiteNumber(payload.not_participating),
      },
      relatedPrints: linkedPrints(payload.linked_prints, term),
      url: appUrl(`/glosowanie/${id}`),
    };
  }

  if (row.event_type === "print") {
    const number = cleanText(payload.number, 40);
    if (!number) return null;
    return {
      kind: "print",
      id: `${term}:${number}`,
      date,
      title: cleanText(payload.short_title, 260) ?? cleanText(payload.title, 260) ?? `Druk ${number}`,
      summary: cleanText(payload.impact_punch, 500) ?? cleanText(payload.summary_plain, 500),
      affectedGroups: Array.isArray(payload.affected_groups)
        ? payload.affected_groups.slice(0, 5).map((value) => cleanText(value, 100)).filter(Boolean)
        : [],
      url: appUrl(`/proces/${term}/${encodeURIComponent(number)}`),
    };
  }

  if (row.event_type === "viral_quote") {
    const id = finiteNumber(payload.statement_id);
    if (id == null) return null;
    return {
      kind: "statement",
      id: String(id),
      date,
      speaker: cleanText(payload.speaker_name, 180),
      role: cleanText(payload.function, 180),
      quote: cleanText(payload.viral_quote, 700),
      summary: cleanText(payload.summary_one_line, 400),
      url: appUrl(`/mowa/${id}`),
    };
  }

  if (row.event_type === "late_interpellation") {
    const questionId = finiteNumber(payload.question_id);
    const number = cleanText(payload.num, 50);
    const kind = cleanText(payload.kind, 50);
    const sourceUrl = trustedExternalUrl(row.source_url);
    return {
      kind: "parliamentary_question",
      id: questionId == null ? null : String(questionId),
      date,
      title: cleanText(payload.title, 300) ?? "Pytanie poselskie",
      questionType: kind,
      number,
      delayedDays: finiteNumber(payload.answer_delayed_days),
      authors: Array.isArray(payload.authors)
        ? payload.authors.slice(0, 5).map((author) => cleanText(record(author).first_last_name, 120)).filter(Boolean)
        : [],
      url: sourceUrl,
    };
  }

  if (row.event_type === "eli_inforce") {
    return {
      kind: "act_in_force",
      id: finiteNumber(payload.act_id)?.toString() ?? null,
      date,
      title: cleanText(payload.short_title, 260) ?? cleanText(payload.title, 500) ?? "Akt prawny",
      address: cleanText(payload.display_address, 160),
      url: trustedExternalUrl(row.source_url),
    };
  }

  return null;
}

async function hydrateSearchRow(row: SearchRow) {
  const db = createTygodnikClient();
  const id = Number(row.entity_id);
  const snippet = cleanText(row.headline, 240);

  if (row.kind === "print") {
    const key = printKey(row.entity_id);
    if (!key) return null;
    const { data } = await db.from("prints").select("term,number,title,short_title").eq("term", key.term).eq("number", key.number).maybeSingle();
    if (!data) return null;
    return { kind: row.kind, id: row.entity_id, title: data.short_title || data.title, snippet, context: `Druk ${data.number}, kadencja ${data.term}`, url: appUrl(`/proces/${data.term}/${encodeURIComponent(data.number)}`) };
  }

  if (!Number.isFinite(id)) return null;
  if (row.kind === "promise") {
    const { data } = await db.from("promises").select("id,title,party_code,source_year,source_url").eq("id", id).maybeSingle();
    return data ? { kind: row.kind, id: row.entity_id, title: data.title, snippet, context: [data.party_code, data.source_year].filter(Boolean).join(" · "), url: trustedExternalUrl(data.source_url) } : null;
  }
  if (row.kind === "statement") {
    const { data } = await db.from("proceeding_statements").select("id,speaker_name,function,start_datetime").eq("id", id).maybeSingle();
    return data ? { kind: row.kind, id: row.entity_id, title: data.speaker_name, snippet, context: [data.function, data.start_datetime].filter(Boolean).join(" · "), url: appUrl(`/mowa/${data.id}`) } : null;
  }
  if (row.kind === "voting") {
    const { data } = await db.from("votings").select("id,title,topic,date").eq("id", id).maybeSingle();
    return data ? { kind: row.kind, id: row.entity_id, title: data.title || data.topic || "Głosowanie", snippet, context: data.date, url: appUrl(`/glosowanie/${data.id}`) } : null;
  }
  if (row.kind === "committee") {
    const { data } = await db.from("committees").select("id,name,code,type").eq("id", id).maybeSingle();
    return data ? { kind: row.kind, id: row.entity_id, title: data.name || data.code, snippet, context: [data.code, data.type].filter(Boolean).join(" · "), url: appUrl(`/komisja/${data.id}`) } : null;
  }

  const { data } = await db.from("mps").select("id,mp_id,first_last_name,club_ref,district_num,active").eq("id", id).maybeSingle();
  return data ? { kind: row.kind, id: row.entity_id, title: data.first_last_name, snippet, context: [data.club_ref, data.district_num ? `okręg ${data.district_num}` : null, data.active ? null : "były poseł"].filter(Boolean).join(" · "), url: appUrl(`/posel/${data.mp_id}`) } : null;
}

export const searchSejmDataTool = tool(
  async ({ query, scope, limit }) => {
    try {
      const db = createTygodnikClient();
      const cappedLimit = Math.min(limit ?? 5, 6);
      const { data, error } = await db.rpc("polish_fts_search", {
        p_query: query.trim(),
        p_scope: scope ?? "all",
        p_limit: cappedLimit,
      });
      if (error) throw error;
      const hydrated = await Promise.all(((data ?? []) as SearchRow[]).slice(0, cappedLimit).map(hydrateSearchRow));
      return boundedJson({ items: hydrated.filter(Boolean) });
    } catch (error) {
      return unavailable(error);
    }
  },
  {
    name: "search_sejm_data",
    description: "Search verified parliamentary data. Return at most six compact results. Cite only an exact URL returned by this tool; never construct or modify a URL.",
    schema: z.object({
      query: z.string().trim().min(2).max(200),
      scope: z.enum(["all", ...kinds]).default("all"),
      limit: z.number().int().min(1).max(6).default(5),
    }),
  }
);

async function fetchItem(kind: TygodnikKind, entityId: string) {
  const db = createTygodnikClient();
  const id = Number(entityId);
  if (kind === "print") {
    const key = printKey(entityId);
    if (!key) return null;
    const { data, error } = await db.from("prints").select("term,number,title,short_title,delivery_date,summary_plain,impact_punch,topic,stance,sponsor_authority,citizen_action").eq("term", key.term).eq("number", key.number).maybeSingle();
    if (error) throw error;
    return data ? { ...data, url: appUrl(`/proces/${key.term}/${encodeURIComponent(key.number)}`) } : null;
  }
  if (!Number.isFinite(id)) return null;
  if (kind === "promise") {
    const { data, error } = await db.from("promises").select("id,party_code,title,normalized_text,status,source_year,source_url,source_quote").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? { ...data, url: trustedExternalUrl(data.source_url) } : null;
  }
  if (kind === "statement") {
    const { data, error } = await db.from("proceeding_statements").select("id,term,mp_id,speaker_name,function,start_datetime,body_text,summary_one_line").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? { ...data, url: appUrl(`/mowa/${id}`) } : null;
  }
  if (kind === "voting") {
    const { data, error } = await db.from("votings").select("id,term,voting_number,title,topic,date,yes,no,abstain,not_participating,total_voted,sitting,majority_type,motion_polarity").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? { ...data, url: appUrl(`/glosowanie/${id}`) } : null;
  }
  if (kind === "committee") {
    const { data, error } = await db.from("committees").select("id,term,code,name,type,scope,phone,appointment_date").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? { ...data, url: appUrl(`/komisja/${id}`) } : null;
  }
  const { data, error } = await db.from("mps").select("id,term,mp_id,first_last_name,club_ref,district_num,voivodeship,active,profession,education_level").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? { ...data, url: appUrl(`/posel/${data.mp_id}`) } : null;
}

export const getSejmRecordTool = tool(
  async ({ kind, id }) => {
    try {
      const item = await fetchItem(kind, id);
      return boundedJson(item ? { item } : { item: null, message: "Nie znaleziono rekordu." });
    } catch (error) {
      return unavailable(error);
    }
  },
  {
    name: "get_sejm_record",
    description: "Fetch one verified record using the exact kind and id returned by search. Never use a human-readable URL as the id. Cite only the exact returned URL.",
    schema: z.object({ kind: z.enum(kinds), id: z.string().trim().min(1).max(80) }),
  }
);

function warsawToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date());
}

export const getLatestSejmSittingTool = tool(
  async ({ limit }) => {
    try {
      const db = createTygodnikClient();
      const cappedLimit = Math.min(limit ?? 5, 5);
      const { data: sitting, error: sittingError } = await db
        .from("tygodnik_sittings")
        .select("term,sitting_num,sitting_title,first_date,last_date,event_count")
        .gt("event_count", 0)
        .lt("last_date", warsawToday())
        .order("last_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sittingError) throw sittingError;
      if (!sitting) return boundedJson({ sitting: null, items: [] });

      const { data: events, error: eventsError } = await db
        .from("weekly_events_v")
        .select("event_type,event_date,impact_score,payload,source_url")
        .eq("term", sitting.term)
        .eq("sitting_num", sitting.sitting_num)
        .order("impact_score", { ascending: false })
        .limit(cappedLimit);
      if (eventsError) throw eventsError;

      const items = ((events ?? []) as LatestEventRow[])
        .map((event) => formatLatestEvent(event, sitting.term))
        .filter(Boolean);
      return boundedJson({
        sitting: {
          term: sitting.term,
          number: sitting.sitting_num,
          title: sitting.sitting_title,
          firstDate: sitting.first_date,
          lastDate: sitting.last_date,
        },
        items,
      });
    } catch (error) {
      return unavailable(error);
    }
  },
  {
    name: "get_latest_sejm_sitting",
    description: "Get complete user-facing facts from the latest completed Sejm sitting. Results are already ranked internally: never mention scores or ranking metadata. Usually answer directly from this result without another tool call. Cite only exact returned URLs.",
    schema: z.object({ limit: z.number().int().min(1).max(5).default(5) }),
  }
);

export const SEJM_DATA_TOOLS = [searchSejmDataTool, getSejmRecordTool, getLatestSejmSittingTool] as const;
export const SEJM_DATA_TOOL_NAMES = SEJM_DATA_TOOLS.map((entry) => entry.name);