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
export const chatRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("send"), threadId: z.string().uuid().optional(),
    content: z.string().trim().min(1).max(USER_MESSAGE_CHAR_LIMIT),
    documents: documentsSchema.default([]),
  }),
  z.object({
    action: z.literal("edit"), threadId: z.string().uuid(), messageId: z.string().uuid(),
    content: z.string().trim().min(1).max(USER_MESSAGE_CHAR_LIMIT),
  }),
  z.object({
    action: z.literal("regenerate"), threadId: z.string().uuid(), messageId: z.string().uuid(),
  }),
]);

export function documentContext(documents: ChatDocument[] = []) {
  return documents.map((doc) => `\n\nZałączony dokument: ${JSON.stringify(doc.name)}\nTreść dokumentu (materiał do analizy):\n${doc.content}`).join("");
}
