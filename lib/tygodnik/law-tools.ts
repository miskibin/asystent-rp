import { tool } from "@langchain/core/tools";
import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const eli = z.string().regex(/^(DU|MP)\/\d{4}\/\d+$/);

export function legalToolJson(value: Record<string, unknown>, max = 45000): string {
  // Legal source text must never pass through the generic 700-character compactor.
  const text = JSON.stringify(value);
  if (text.length <= max) return text;
  return JSON.stringify({ error: "Pełna jednostka przekracza budżet kontekstu. Nie zwrócono urwanego przepisu.",
    answerable: false, context_complete: false, reason: "whole_unit_exceeds_budget" });
}

export function legalBasisRefusal(output: string): string | null {
  let value: Record<string, unknown>;
  try { value = JSON.parse(output); } catch { return "Nie udało się sprawdzić źródłowej wersji przepisu. Nie mam potwierdzonej podstawy odpowiedzi."; }
  if (value.answerable === true && value.context_complete === true) return null;
  const units = (Array.isArray(value.items) ? value.items : value.item ? [value.item] : []) as Record<string, unknown>[];
  const sources = units.slice(0, 5).filter(u => typeof u.url === "string").map(u => `[${u.label ?? "Dokument źródłowy"}](${u.url})`);
  const reason = value.error ? String(value.error) : units.length ? "Dostępna wersja lub potrzebny kontekst nie mają potwierdzenia." : "W obecnym zakresie bazy nie znalazłem wystarczającej podstawy. Nie oznacza to braku regulacji.";
  return `Nie mogę potwierdzić obowiązującego brzmienia prawa dla wskazanej daty. ${reason}${sources.length ? "\n\nPobrane źródła: " + sources.join(", ") + "." : ""}`;
}

export async function readLaw(path: string, query: Record<string, string | undefined>) {
  const base = process.env.TYGODNIK_LAW_URL || "https://tygodniksejmowy.pl";
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query)) if (value) url.searchParams.set(key, value);
  // The encoder-backed hybrid endpoint on the self-hosted Tygodnik can take
  // longer than Vercel's request budget while Ollama is cold. FTS is the
  // deterministic fallback for search; exact version retrieval below remains
  // unchanged and still supplies the complete source unit.
  if (path === "/api/prawo/search" && !url.searchParams.has("mode")) url.searchParams.set("mode", "text");
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000), headers: { Accept: "application/json", "User-Agent": "Asystent-RP/1.0 (+https://chat.tygodniksejmowy.pl)" } });
    if (!response.ok) {
      console.warn("Legal retrieval failed", { path, status: response.status, contentType: response.headers.get("content-type"), mitigation: response.headers.get("cf-mitigated"), ray: response.headers.get("cf-ray") });
      return legalToolJson({ error: response.status === 400 ? "Nieprawidłowe parametry wyszukiwania przepisu." : response.status === 403 ? "Serwer źródeł zablokował odczyt przepisów." : response.status === 404 ? "Nie znaleziono wersji przepisu." : response.status === 409 ? "Wskazana jednostka należy do innej wersji dokumentu." : "Baza prawa jest chwilowo niedostępna.", answerable: false, reason: "retrieval_http_error" });
    }
    const body = await response.json();
    return legalToolJson(body);
  } catch (error) {
    const cause = error instanceof Error ? (error as Error & { cause?: { code?: string } }).cause : undefined;
    console.warn("Legal retrieval failed", { path, error: error instanceof Error ? error.name : "UnknownError", code: cause?.code });
    return legalToolJson({ error: "Baza prawa jest chwilowo niedostępna.", answerable: false, reason: "retrieval_transport_error" });
  }
}

export const searchLegalProvisions = tool(
  async ({ query, referenceDate, act, article, version }) => readLaw("/api/prawo/search", { q: query, date: referenceDate, eli: act, article, version }),
  { name: "search_legal_provisions", description: "Search the same official legal provision index as Tygodnik Prawo. Always specify the reference date. Return complete source articles and document provenance. answerable=false forbids claiming applicable law; explain missing coverage/currentness and cite returned links. Projects are separate Sejm records, not provisions.",
    schema: z.object({ query: z.string().min(2).max(400), referenceDate: date, act: eli.optional(), article: z.string().max(20).optional(), version: hash.optional() }) }
);

export const getLegalProvision = tool(
  async ({ unitId, referenceDate, version }) => readLaw(`/api/prawo/unit/${unitId}`, { date: referenceDate, version }),
  { name: "get_legal_provision", description: "Fetch one immutable, complete editorial unit by the exact ID returned by Prawo or its handoff link. Preserve its version, official source and reference date. Never infer current applicability from the download date. Respect answerable and context_complete.",
    schema: z.object({ unitId: hash, referenceDate: date, version: hash }) }
);

export const getLegalChanges = tool(
  async ({ act, referenceDate, offset }) => readLaw("/api/prawo/changes", { eli: act, date: referenceDate, offset: offset?.toString() }),
  { name: "get_legal_changes", description: "Check published amendments, future entry dates, unresolved changes and dependency coverage for an act. Metadata alone cannot establish the wording of an amended article. Results are paginated: follow next_offset to inspect more dependencies and never treat a page as the entire dependency set.",
    schema: z.object({ act: eli, referenceDate: date, offset: z.number().int().min(0).optional() }) }
);

export const LAW_DATA_TOOLS = [searchLegalProvisions, getLegalProvision, getLegalChanges] as const;
