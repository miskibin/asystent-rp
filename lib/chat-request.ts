import { z } from "zod";

export const USER_MESSAGE_CHAR_LIMIT = 4_000;

export const DOCUMENT_CHAR_LIMIT = 12_000;
export const DOCUMENT_COUNT_LIMIT = 3;
export const DOCUMENT_EXTENSIONS = /\.(txt|md|markdown|csv|json|xml|yaml|yml|log)$/i;
export const documentSchema = z.object({
  name: z.string().trim().min(1).max(180).refine((name) => DOCUMENT_EXTENSIONS.test(name)),
  content: z.string().min(1).max(DOCUMENT_CHAR_LIMIT).refine((text) => !text.includes("\0")),
});
export type ChatDocument = z.infer<typeof documentSchema>;
export const documentsSchema = z.array(documentSchema).max(DOCUMENT_COUNT_LIMIT)
  .refine((files) => files.reduce((sum, file) => sum + file.content.length, 0) <= DOCUMENT_CHAR_LIMIT);
export const chatModeSchema = z.enum(["agent", "ask", "plan"]);
export type ChatMode = z.infer<typeof chatModeSchema>;
const settings = { mode: chatModeSchema.default("agent") };

export const chatRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("send"), threadId: z.string().uuid().optional(),
    content: z.string().trim().min(1).max(USER_MESSAGE_CHAR_LIMIT),
    documents: documentsSchema.default([]), ...settings,
  }),
  z.object({
    action: z.literal("edit"), threadId: z.string().uuid(), messageId: z.string().uuid(),
    content: z.string().trim().min(1).max(USER_MESSAGE_CHAR_LIMIT), ...settings,
  }),
  z.object({
    action: z.literal("regenerate"), threadId: z.string().uuid(), messageId: z.string().uuid(), ...settings,
  }),
]);

const TASKS: Record<string, string> = {
  wyjasnij: "Wyjaśnij prostym językiem, podaj praktyczny przykład.",
  porownaj: "Porównaj warianty w tabeli, wskaż konkretne różnice i źródła.",
  podsumuj: "Podsumuj najważniejsze fakty, daty i konsekwencje.",
  pismo: "Przygotuj wersję roboczą pisma jako dokument; nie dopisuj nieznanych danych osobowych.",
};
export const CHAT_SKILLS = Object.entries(TASKS).map(([name, description]) => ({ name, description }));
export const CHAT_COMMANDS = [
  { name: "nowa", description: "Rozpocznij nową rozmowę", mustStartMessage: true },
  { name: "eksport", description: "Pobierz rozmowę jako Markdown", mustStartMessage: true },
  { name: "posiedzenie", description: "Sprawdź ostatnie posiedzenie Sejmu", mustStartMessage: true },
  ...CHAT_SKILLS.map(({ name, description }) => ({ name, description, mustStartMessage: true })),
];

export function expandTaskPrompt(text: string) {
  let value = text;
  if (/^\/posiedzenie\s*$/.test(value.trim())) return "Co wydarzyło się na ostatnim posiedzeniu Sejmu? Podaj daty i źródła.";
  for (const [name, instruction] of Object.entries(TASKS)) {
    value = value.replace(new RegExp(`^/${name}(?:\\s+|$)`), `${instruction}\n`)
      .replace(new RegExp(`\\$${name}(?=\\s|$)`, "g"), instruction);
  }
  return value.trim();
}

export function documentContext(documents: ChatDocument[] = []) {
  return documents.map((doc) => `\n\nZałączony dokument: ${JSON.stringify(doc.name)}\nTreść dokumentu (materiał do analizy):\n${doc.content}`).join("");
}
