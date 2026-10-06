import type { Message } from "./types";

export type ChatFile = { id: string; messageId: string; toolId?: string; path: string; title: string; content: string; language?: string };
export function safeDocumentName(name: string) {
  return name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 180) || "dokument.md";
}
export function filesFromMessages(messages: Message[]): ChatFile[] {
  return messages.flatMap((message, messageIndex) => {
    const documents = (message.documents ?? []).map((doc, index) => ({
      id: `${message.id}:attachment:${index}`, messageId: message.id,
      path: `Załączniki/${messageIndex + 1}.${index + 1}-${safeDocumentName(doc.name)}`, title: doc.name, content: doc.content,
    }));
    const generated: ChatFile[] = [];
    for (const [partIndex, part] of (message.parts ?? []).entries()) {
      if (part.type !== "tool" || part.tool.status !== "done") continue;
      try {
        const input = JSON.parse(part.tool.input ?? "{}") as Record<string, unknown>;
        const content = part.tool.name === "draft_document" ? input.content : part.tool.name === "create_plan" ? input.plan : undefined;
        if (typeof content !== "string") continue;
        const title = typeof input.title === "string" ? input.title : "Dokument";
        generated.push({ id: `${message.id}:tool:${part.tool.id}`, messageId: message.id, toolId: part.tool.id, path: `Dokumenty/${messageIndex + 1}.${partIndex + 1}-${safeDocumentName(title)}.md`, title, content, language: "markdown" });
      } catch { /* Incomplete tool arguments are not documents. */ }
    }
    return [...documents, ...generated];
  });
}

export function exportConversation(messages: Message[], title: string) {
  return `# ${title}\n\n` + messages.map((message) => {
    const files = filesFromMessages([message]);
    return `## ${message.role === "user" ? "Ty" : "Asystent RP"}\n\n${message.content}\n` +
      files.map((file) => `\n### ${file.title}\n\n${file.content}\n`).join("") +
      (message.sources?.length ? `\nŹródła:\n${message.sources.map((url) => `- ${url}`).join("\n")}\n` : "");
  }).join("\n");
}
