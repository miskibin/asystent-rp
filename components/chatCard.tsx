import React, { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Send, StopCircle, Loader2, AlertTriangle } from "lucide-react";
import InitialChatContent from "@/components/initial-page";
import { useChatContext } from "@/app/ChatContext";
import { ChatMessage } from "./message";
import { cn } from "@/lib/utils";

export function ChatCard() {
  const {
    messages,
    isLoading,
    status,
    input,
    setInput,
    handleSubmit,
    stopGenerating,
    clearMessages, // Used when clicking `Zapytaj o coś innego`
  } = useChatContext();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const shouldScroll = messages.length > 0 || isLoading || status;

    if (shouldScroll) {
      const timeoutId = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100); // Small delay to ensure content is rendered

      return () => clearTimeout(timeoutId);
    }
  }, [messages, isLoading, status]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
      if (textareaRef.current) {
        textareaRef.current.style.height = "56px";
      }
    }
  };

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "56px";
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(
        Math.max(scrollHeight, 56),
        200
      )}px`;
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    adjustTextareaHeight();
  };

  const renderLoadingState = () => {
    if (!isLoading || messages[messages.length - 1]?.content !== "") {
      return null;
    }

    return (
      <div className="flex w-full flex-col items-center justify-center space-y-4 my-8">
        <div className="flex items-center justify-center space-x-2 text-muted-foreground ">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm font-medium">Myślę...</span>
        </div>

        {status && (
          <div
            className={cn(
              "text-sm px-3 py-1 rounded-full",
              "bg-primary/5 text-primary/80",
              "flex items-center gap-2 max-w-md",
              status.includes("Executing") && "animate-pulse"
            )}
          >
            <div className="relative flex-shrink-0 h-2 w-2">
              <div className="absolute h-2 w-2 bg-primary/60 rounded-full animate-ping" />
              <div className="relative h-2 w-2 bg-primary rounded-full" />
            </div>
            <span className="truncate">
              {status.includes("Executing")
                ? status
                    .replace("Executed", "Sprawdzam")
                    .replace("tool...", "dane...")
                : status}
            </span>
          </div>
        )}
      </div>
    );
  };
  return (
    <Card className="h-full flex flex-col items-center border-t-0 shadow-none rounded-t-none">
      <CardContent className="flex-grow w-full max-w-6xl overflow-y-auto px-1 sm:px-4">
        {messages.length === 0 ? (
          <InitialChatContent
            onStarterClick={(text) =>
              handleSubmit(
                new Event("submit") as unknown as React.FormEvent,
                text
              )
            }
          />
        ) : (
          <div className="space-y-4">
            {messages
              .filter((message) => message.content !== "")
              .map((message, index) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isLastMessage={index === messages.length - 1}
                />
              ))}
            {renderLoadingState()}
          </div>
        )}
        <div ref={messagesEndRef} />
      </CardContent>
      {!isLoading && messages.length >= 2 && (
          <Button
            onClick={clearMessages}
            variant="ghost"
            className=" mb-2 sm:mb-4 text-primary underline "
          >
            Zapytaj o coś innego
          </Button>
        )}
      {isLoading && (
        <div className="w-full max-w-3xl mx-auto px-4 mb-2 sm:mb-4">
          <div className="flex items-start gap-3 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
            <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p>
                Asystent może popełniać błędy. Aby je zminimalizować, wybierz
                lepszy model.
              </p>
            </div>
          </div>
        </div>
      )}

      <CardFooter className="w-full mt-0 sm:mt-1 items-center justify-center sticky bottom-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(e);
          }}
          className="flex flex-col space-y-2 w-full max-w-3xl"
        >
          <div className="relative flex-1">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                isLoading
                  ? "Odpowiadam! Nie przerwaj mi proszę..."
                  : messages.some((message) => (message.artifacts?.length ?? 0) > 0)
                  ? "Dopytaj o coś w tej sprawie"
                  : "Zapytaj mnie o kwestię prawną"
              }
              disabled={isLoading}
              className="pr-24 pl-4 py-3 resize-none min-h-[56px] max-h-[200px] w-full rounded-2xl border-2 focus:ring-2 focus:ring-primary/50 transition-all overflow-y-auto scrollbar-hide hover:scrollbar-default"
              rows={1}
              maxLength={800}
            />
            <div className="absolute bottom-2 right-2 flex items-center space-x-1">
      
              {isLoading ? (
                <Button
                  type="button"
                  onClick={stopGenerating}
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-full hover:bg-red-100 transition-colors"
                >
                  <StopCircle className="h-5 w-5 text-red-500" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={isLoading}
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-full hover:bg-primary/10 text-primary transition-colors"
                >
                  <Send className="h-5 w-5" />
                </Button>
              )}
            </div>
          </div>
        </form>
      
      </CardFooter>
    </Card>
  );
}
