import { tool } from "langchain";
import { z } from "zod";

import { createTygodnikClient } from "./client";

const SITE_URL = "https://tygodniksejmowy.pl";
const kinds = ["print", "promise", "statement", "voting", "committee", "mp"] as const;
type TygodnikKind = (typeof kinds)[number];

type SearchRow = {
  kind: TygodnikKind;
  entity_id: string;
  rank: number;
  headline: string | null;
};

function cleanText(value: unknown, max = 700): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
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
  return boundedJson({ error: "Dane Tygodnika są chwilowo niedostępne." }, 300);
}

function absoluteUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function printKey(entityId: string): { term: number; number: string } | null {
  const [rawTerm, ...numberParts] = entityId.split(":");
  const term = Number(rawTerm);
  const number = numberParts.join(":");
  return Number.isFinite(term) && number ? { term, number } : null;
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
    return { kind: row.kind, id: row.entity_id, title: data.short_title || data.title, snippet, meta: `Druk ${data.number}, kadencja ${data.term}`, url: absoluteUrl(`/proces/${data.term}/${data.number}`) };
  }

  if (!Number.isFinite(id)) return null;
  if (row.kind === "promise") {
    const { data } = await db.from("promises").select("id,title,party_code,source_year").eq("id", id).maybeSingle();
    return data ? { kind: row.kind, id: row.entity_id, title: data.title, snippet, meta: [data.party_code, data.source_year].filter(Boolean).join(" · "), url: absoluteUrl("/obietnice") } : null;
  }
  if (row.kind === "statement") {
    const { data } = await db.from("proceeding_statements").select("id,speaker_name,function,start_datetime").eq("id", id).maybeSingle();
    return data ? { kind: row.kind, id: row.entity_id, title: data.speaker_name, snippet, meta: [data.function, data.start_datetime].filter(Boolean).join(" · "), url: absoluteUrl(`/mowa/${data.id}`) } : null;
  }
  if (row.kind === "voting") {
    const { data } = await db.from("votings").select("id,title,topic,date").eq("id", id).maybeSingle();
    return data ? { kind: row.kind, id: row.entity_id, title: data.title || data.topic || "Głosowanie", snippet, meta: data.date, url: absoluteUrl(`/glosowanie/${data.id}`) } : null;
  }
  if (row.kind === "committee") {
    const { data } = await db.from("committees").select("id,name,code,type").eq("id", id).maybeSingle();
    return data ? { kind: row.kind, id: row.entity_id, title: data.name || data.code, snippet, meta: [data.code, data.type].filter(Boolean).join(" · "), url: absoluteUrl(`/komisja/${data.id}`) } : null;
  }

  const { data } = await db.from("mps").select("id,mp_id,first_last_name,club_ref,district_num,active").eq("id", id).maybeSingle();
  return data ? { kind: row.kind, id: row.entity_id, title: data.first_last_name, snippet, meta: [data.club_ref, data.district_num ? `okręg ${data.district_num}` : null, data.active ? null : "były poseł"].filter(Boolean).join(" · "), url: absoluteUrl(`/posel/${data.mp_id}`) } : null;
}

export const searchTygodnikTool = tool(
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
    name: "search_tygodnik",
    description: "Search Tygodnik Sejmowy for Polish parliamentary prints, promises, speeches, votings, committees or MPs. Use once, then optionally fetch one item. Cite returned URLs.",
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
    return data ? { ...data, url: absoluteUrl(`/proces/${key.term}/${key.number}`) } : null;
  }
  if (!Number.isFinite(id)) return null;
  if (kind === "promise") {
    const { data, error } = await db.from("promises").select("id,party_code,title,normalized_text,status,source_year,source_url,source_quote,confidence").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  }
  if (kind === "statement") {
    const { data, error } = await db.from("proceeding_statements").select("id,term,mp_id,speaker_name,function,start_datetime,body_text,summary_one_line").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? { ...data, url: absoluteUrl(`/mowa/${id}`) } : null;
  }
  if (kind === "voting") {
    const { data, error } = await db.from("votings").select("id,term,voting_number,title,topic,date,yes,no,abstain,not_participating,total_voted,sitting,majority_type,motion_polarity").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? { ...data, url: absoluteUrl(`/glosowanie/${id}`) } : null;
  }
  if (kind === "committee") {
    const { data, error } = await db.from("committees").select("id,term,code,name,type,scope,phone,appointment_date").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? { ...data, url: absoluteUrl(`/komisja/${id}`) } : null;
  }
  const { data, error } = await db.from("mps").select("id,term,mp_id,first_last_name,club_ref,district_num,voivodeship,active,profession,education_level").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? { ...data, url: absoluteUrl(`/posel/${data.mp_id}`) } : null;
}

export const getTygodnikItemTool = tool(
  async ({ kind, id }) => {
    try {
      const item = await fetchItem(kind, id);
      return boundedJson(item ? { item } : { item: null, message: "Nie znaleziono rekordu." });
    } catch (error) {
      return unavailable(error);
    }
  },
  {
    name: "get_tygodnik_item",
    description: "Fetch one compact Tygodnik Sejmowy record selected from search results. Never use it for bulk reading. Cite the returned URL.",
    schema: z.object({ kind: z.enum(kinds), id: z.string().trim().min(1).max(80) }),
  }
);

function warsawToday() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date());
}

export const getLatestTygodnikTool = tool(
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
      return boundedJson({ sitting, items: (events ?? []).map((event) => ({ ...event, source_url: absoluteUrl(event.source_url) })) });
    } catch (error) {
      return unavailable(error);
    }
  },
  {
    name: "get_latest_tygodnik",
    description: "Get up to five highest-impact events from the latest completed Sejm sitting in Tygodnik Sejmowy. Use for questions like 'what happened recently?'. Cite returned source URLs.",
    schema: z.object({ limit: z.number().int().min(1).max(5).default(5) }),
  }
);

export const TYGODNIK_TOOLS = [searchTygodnikTool, getTygodnikItemTool, getLatestTygodnikTool] as const;
export const TYGODNIK_TOOL_NAMES = TYGODNIK_TOOLS.map((entry) => entry.name);
