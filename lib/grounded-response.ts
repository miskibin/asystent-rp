const MARKDOWN_LINK_RE = /\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/gi;
const BARE_URL_RE = /https?:\/\/[^\s<>()\]]+/gi;

function normalizedUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function collectHttpUrls(value: unknown, urls = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const normalized = normalizedUrl(value);
    if (normalized) urls.add(normalized);
    return urls;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectHttpUrls(entry, urls));
    return urls;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectHttpUrls(entry, urls));
  }
  return urls;
}

export function collectHttpUrlsFromToolOutput(output: string): Set<string> {
  try {
    return collectHttpUrls(JSON.parse(output));
  } catch {
    return new Set();
  }
}

export function keepOnlyGroundedLinks(text: string, allowedUrls: Set<string>): string {
  const allowed = (value: string) => {
    const normalized = normalizedUrl(value.replace(/[.,;:!?]+$/, ""));
    return normalized ? allowedUrls.has(normalized) : false;
  };

  const withoutInventedMarkdown = text.replace(
    MARKDOWN_LINK_RE,
    (match, label: string, url: string) => (allowed(url) ? match : label)
  );

  return withoutInventedMarkdown.replace(BARE_URL_RE, (url) =>
    allowed(url) ? url : ""
  );
}

export function summarizeToolOutput(name: string, output: string): string {
  try {
    const value = JSON.parse(output) as Record<string, unknown>;
    if (value.error) return String(value.error);
    if (name === "get_latest_sejm_sitting") {
      const count = Array.isArray(value.items) ? value.items.length : 0;
      return count === 1 ? "Pobrano 1 wydarzenie." : `Pobrano ${count} wydarzenia.`;
    }
    if (name === "search_sejm_data") {
      const count = Array.isArray(value.items) ? value.items.length : 0;
      return count === 1 ? "Znaleziono 1 wynik." : `Znaleziono ${count} wyników.`;
    }
    if (name === "get_sejm_record") {
      return value.item ? "Pobrano szczegóły." : "Nie znaleziono rekordu.";
    }
  } catch {
    // Keep the UI compact even if a provider wraps the tool output.
  }
  return "Zakończono odczyt danych.";
}

export function displayToolName(name: string): string {
  if (name === "get_latest_sejm_sitting") return "Sprawdzanie ostatniego posiedzenia Sejmu";
  if (name === "search_sejm_data") return "Wyszukiwanie w danych Sejmu";
  if (name === "get_sejm_record") return "Pobieranie szczegółów z danych Sejmu";
  return name;
}