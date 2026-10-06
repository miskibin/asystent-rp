import { tool } from "@langchain/core/tools";
import { z } from "zod";

const boundedText = z.string().min(1).max(12_000);
const todos = z.array(z.object({
  content: z.string().min(1).max(300),
  status: z.enum(["pending", "in_progress", "completed"]),
})).max(12);

export const CHAT_UI_TOOLS = [
  tool(async () => JSON.stringify({ answers: {}, source: "agent" }), {
    name: "ask_question",
    description: "Poproś użytkownika o brakujący istotny kontekst poprzez formularz wyboru. Kończy tę odpowiedź; użytkownik odpowie w następnej wiadomości.",
    schema: z.object({ title: z.string().max(120), questions: z.array(z.object({
      id: z.string().min(1).max(80), prompt: z.string().min(1).max(400),
      options: z.array(z.object({ id: z.string().min(1).max(80), label: z.string().min(1).max(200) })).min(2).max(5),
      allowMultiple: z.boolean().default(false),
    })).min(1).max(3) }),
  }),
  tool(async () => "Plan przedstawiony użytkownikowi. Nie oznacza wykonania działań.", {
    name: "create_plan", description: "Przedstaw konkretny plan dalszej analizy albo kolejnych kroków obywatela. Nie wykonuje żadnych działań za użytkownika.",
    schema: z.object({ title: z.string().min(1).max(120), plan: boundedText, todos }),
  }),
  tool(async () => "Lista zadań przedstawiona użytkownikowi.", {
    name: "set_todos", description: "Przedstaw praktyczną listę zadań. completed wyłącznie dla pracy faktycznie wykonanej w tej rozmowie; czynności użytkownika są pending.",
    schema: z.object({ todos }),
  }),
  tool(async () => "Wersja robocza dostępna w podglądzie dokumentu. Nie została wysłana do żadnego urzędu.", {
    name: "draft_document", description: "Przygotuj pismo lub notatkę jako dokument Markdown do podglądu, kopiowania i pobrania. Cytuj wyłącznie źródła zwrócone przez narzędzia danych.",
    schema: z.object({ title: z.string().min(1).max(120), content: boundedText }),
  }),
];
export const CHAT_UI_TOOL_NAMES = CHAT_UI_TOOLS.map((entry) => entry.name);
