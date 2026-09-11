"use client";

import { useEffect, useRef } from "react";
import { AlertCircle, X } from "lucide-react";

import InitialChatContent from "@/components/initial-page";
import { ChatMessage } from "@/components/message";
import { useChatContext } from "@/app/ChatContext";
import { Button } from "@/components/ui/button";
import { ChatComposer } from "@/components/ui/chat-composer";
import { GenerationStatus } from "@/components/ui/generation-status";

export function ChatCard() {
  const { messages, isLoading, status, errorMessage, clearError, input, setInput, handleSubmit, isPdfParsing, stopGenerating, clearMessages } = useChatContext();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const visibleMessages = messages.filter((message) => message.content !== "");
  const lastMessage = messages[messages.length - 1];
  const isWaitingForFirstToken = isLoading && lastMessage?.content === "";

  useEffect(() => {
    if (messages.length === 0 && !isLoading) return;
    const timeoutId = window.setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
    return () => window.clearTimeout(timeoutId);
  }, [isLoading, messages, status]);

  const send = () => {
    void handleSubmit(new Event("submit") as unknown as React.FormEvent);
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-3 py-5 sm:px-5 sm:py-7">
          {visibleMessages.length === 0 ? (
            <div className="flex min-h-full flex-1 items-center justify-center">
              <InitialChatContent onStarterClick={(prompt) => void handleSubmit(new Event("submit") as unknown as React.FormEvent, prompt)} />
            </div>
          ) : (
            <div className="space-y-5">
              {visibleMessages.map((message, index) => <ChatMessage key={message.id} message={message} isLastMessage={index === messages.length - 1} />)}
              {isWaitingForFirstToken ? <GenerationStatus active label={status || "Przygotowuję odpowiedź"} className="pl-10" /> : null}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t bg-background/95 px-3 py-3 backdrop-blur sm:px-5 sm:py-4">
        <div className="mx-auto w-full max-w-3xl">
          {errorMessage ? (
            <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 flex-1">{errorMessage}</p>
              <Button type="button" variant="ghost" size="icon" onClick={clearError} className="-mr-2 -mt-1 h-8 w-8 text-destructive" aria-label="Zamknij komunikat błędu"><X className="h-4 w-4" /></Button>
            </div>
          ) : null}
          {messages.length >= 2 && !isLoading ? <Button type="button" variant="ghost" onClick={clearMessages} className="mb-2 h-8 px-2 text-xs text-muted-foreground">Rozpocznij nową rozmowę</Button> : null}
          <ChatComposer value={input} onValueChange={setInput} onSend={send} onStop={stopGenerating} isGenerating={isLoading} disabled={isPdfParsing} placeholder="Opisz swoją sprawę prawną…" maxLength={800} footer="Enter — wyślij · Shift+Enter — nowa linia" />
        </div>
      </div>
    </section>
  );
}
