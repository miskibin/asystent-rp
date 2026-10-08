export function lawDraft(params: URLSearchParams): string | null {
  const unit = params.get("law_unit"), version = params.get("law_version"), date = params.get("law_date");
  if (!unit || !version || !date || !/^[a-f0-9]{64}$/.test(unit) || !/^[a-f0-9]{64}$/.test(version) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return null;
  return `Wyjaśnij jednostkę przepisu ${unit}, wersję ${version}. Pobierz pełny tekst i sprawdź aktualność oraz kontekst na ${date}. Nie zakładaj, że tekst obowiązuje.`;
}

export const LAW_HANDOFF_STORAGE = "asystent-rp-law-handoff";
export function lawHandoffQuery(params: URLSearchParams): string | null {
  if (!lawDraft(params)) return null;
  return new URLSearchParams(Object.fromEntries(["law_unit", "law_version", "law_date"].map(key => [key, params.get(key)!]))).toString();
}
