import { useRef, useState } from "react";

import { useToast } from "./use-toast";
import { StreamProcessor } from "./streamProcessor";
import type { Message } from "@/lib/types";
import { generateUniqueId } from "@/utils/common";
import { useChatStore } from "@/lib/store";

const toApiMessages = (messages: Message[]) =>
  messages
    .filter(
      (message): message is Message & { role: "user" | "assistant" } =>
        (message.role === "user" || message.role === "assistant") &&
        message.content.trim().length > 0
    )
    .slice(-100)
    .map(({ role, content }) => ({ role, content: content.slice(0, 20_000) }));

export const useChatLogic = () => {
  const { messages, addMessage, updateMessage, clearMessages, input, setInput } =
    useChatStore();
  const { toast } = useToast();
  const abortControllerRef = useRef<AbortController | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleError = (error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") return;
    setErrorMessage("Nie udało się uzyskać odpowiedzi. Spróbuj ponownie za chwilę.");
    toast({
      title: "Błąd podczas odpowiadania",
      description: "Spróbuj ponownie za chwilę.",
      variant: "destructive",
      duration: 5000,
    });
  };

  const getResponse = async (history: Message[], messageId: string) => {
    abortControllerRef.current = new AbortController();
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: toApiMessages(history) }),
      signal: abortControllerRef.current.signal,
    });

    if (!response.ok) throw new Error(`Chat request failed: ${response.status}`);
    if (!response.body) throw new Error("Assistant response did not stream");

    await new StreamProcessor(updateMessage, setStatus, handleError).processStream(
      response.body.getReader(),
      messageId
    );
  };

  const handleSubmit = async (event: React.FormEvent, text?: string) => {
    event.preventDefault();
    const content = (text ?? input).trim();
    if (!content || isLoading) return;
    setErrorMessage(null);

    const userMessage: Message = { id: generateUniqueId(), role: "user", content };
    const assistantMessage: Message = { id: generateUniqueId(), role: "assistant", content: "" };
    const history = [...messages, userMessage];

    addMessage(userMessage);
    addMessage(assistantMessage);
    setInput("");
    setIsLoading(true);
    setStatus(null);

    try {
      await getResponse(history, assistantMessage.id);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
      setStatus(null);
      abortControllerRef.current = null;
    }
  };

  const editMessage = async (id: string, content: string) => {
    const index = messages.findIndex((message) => message.id === id);
    if (index === -1) return;
    const updated = { ...messages[index], content };
    if (updated.role !== "user") {
      updateMessage(id, updated);
      return;
    }

    const history = [...messages.slice(0, index), updated];
    clearMessages();
    history.forEach(addMessage);
    const assistantMessage: Message = { id: generateUniqueId(), role: "assistant", content: "" };
    addMessage(assistantMessage);
    setIsLoading(true);
    try {
      await getResponse(history, assistantMessage.id);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
    setEditingMessageId(null);
  };

  const regenerateMessage = async (id: string) => {
    const index = messages.findIndex((message) => message.id === id && message.role === "assistant");
    if (index === -1) return;
    const history = messages.slice(0, index);
    clearMessages();
    history.forEach(addMessage);
    const assistantMessage: Message = { id: generateUniqueId(), role: "assistant", content: "" };
    addMessage(assistantMessage);
    setIsLoading(true);
    try {
      await getResponse(history, assistantMessage.id);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  return {
    isLoading,
    status,
    errorMessage,
    clearError: () => setErrorMessage(null),
    editMessage,
    regenerateMessage,
    handleSubmit,
    clearChat: clearMessages,
    stopGenerating: () => {
      abortControllerRef.current?.abort();
      setIsLoading(false);
    },
    setEditingMessageId,
    editingMessageId,
  };
};
