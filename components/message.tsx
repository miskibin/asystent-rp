"use client";

import { useState } from "react";
import { Check, Copy, Edit, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import MarkdownResponse from "@/components/markdownResponse";
import { useChatContext } from "@/app/ChatContext";
import type { Message } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ChatMessage({ message, isLastMessage }: { message: Message; isLastMessage: boolean }) {
  const { isLoading, editingMessageId, setEditingMessageId, editMessage, regenerateMessage, deleteMessage } = useChatContext();
  const [editInput, setEditInput] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const isGenerating = isLoading && isLastMessage;

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <article className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[92%] rounded-xl px-3 py-2 text-sm leading-6 sm:max-w-[85%]", message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted/60", editingMessageId === message.id && "w-full max-w-full")}>
        {editingMessageId === message.id ? (
          <div>
            <Textarea value={editInput} onChange={(event) => setEditInput(event.target.value)} />
            <div className="mt-2 flex justify-end gap-1">
              <Button size="icon" variant="ghost" onClick={() => void editMessage(message.id, editInput)} aria-label="Zapisz"><Check className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => setEditingMessageId(null)} aria-label="Anuluj"><X className="h-4 w-4" /></Button>
            </div>
          </div>
        ) : (
          <>
            <MarkdownResponse content={message.content} />
            {!isGenerating ? (
              <div className="mt-1 flex gap-1 opacity-70">
                {message.role === "assistant" ? (
                  <>
                    <Button size="icon" variant="ghost" onClick={() => void regenerateMessage(message.id)} aria-label="Wygeneruj ponownie"><RefreshCw className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => void copy()} aria-label="Kopiuj">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button>
                  </>
                ) : (
                  <>
                    <Button size="icon" variant="ghost" onClick={() => setEditingMessageId(message.id)} aria-label="Edytuj"><Edit className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => deleteMessage(message.id)} aria-label="Usuń"><Trash2 className="h-4 w-4" /></Button>
                  </>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}
