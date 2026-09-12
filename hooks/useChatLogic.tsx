import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "./use-toast";
import { StreamProcessor } from "./streamProcessor";
import {
  deleteChatThread,
  deletePersistedMessage,
  listChatThreads,
  loadChatMessages,
  type ChatThread,
} from "@/lib/chat-persistence";
import type { Message } from "@/lib/types";
import { createClientComponentClient } from "@/lib/supabase/client";
import { generateUniqueId } from "@/utils/common";
import { useChatStore } from "@/lib/store";

type ChatRequest =
  | { action: "send"; threadId?: string; content: string }
  | { action: "edit"; threadId: string; messageId: string; content: string }
  | { action: "regenerate"; threadId: string; messageId: string };

export const useChatLogic = () => {
  const {
    messages,
    addMessage,
    setMessages,
    updateMessage,
    replaceMessageId,
    clearMessages,
    input,
    setInput,
  } = useChatStore();
  const supabase = useMemo(() => createClientComponentClient(), []);
  const { toast } = useToast();
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const activeThreadRef = useRef<string | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadIdState] = useState<string | null>(null);
  const [isThreadsLoading, setIsThreadsLoading] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const setActiveThreadId = useCallback((id: string | null) => {
    activeThreadRef.current = id;
    setActiveThreadIdState(id);
  }, []);

  const handleError = useCallback((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") return;
    setErrorMessage("Nie udało się uzyskać odpowiedzi. Spróbuj ponownie za chwilę.");
    toast({
      title: "Błąd podczas odpowiadania",
      description: "Spróbuj ponownie za chwilę.",
      variant: "destructive",
      duration: 5000,
    });
  }, [toast]);

  const stopGenerating = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
    setStatus(null);
  }, []);

  const upsertThread = useCallback((thread: ChatThread) => {
    setThreads((current) =>
      [thread, ...current.filter((item) => item.id !== thread.id)]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 50)
    );
  }, []);

  const switchThread = useCallback(async (threadId: string) => {
    stopGenerating();
    const version = ++requestVersionRef.current;
    setActiveThreadId(threadId);
    setEditingMessageId(null);
    setMessages([]);
    try {
      const loaded = await loadChatMessages(supabase, threadId);
      if (requestVersionRef.current === version && activeThreadRef.current === threadId) {
        setMessages(loaded);
      }
    } catch (error) {
      handleError(error);
    }
  }, [handleError, setActiveThreadId, setMessages, stopGenerating, supabase]);

  const newThread = useCallback(() => {
    stopGenerating();
    requestVersionRef.current += 1;
    setActiveThreadId(null);
    setEditingMessageId(null);
    clearMessages();
    setErrorMessage(null);
  }, [clearMessages, setActiveThreadId, stopGenerating]);

  const deleteThread = useCallback(async (threadId: string) => {
    stopGenerating();
    try {
      await deleteChatThread(supabase, threadId);
      const remaining = threads.filter((thread) => thread.id !== threadId);
      setThreads(remaining);
      if (activeThreadRef.current === threadId) {
        if (remaining[0]) await switchThread(remaining[0].id);
        else newThread();
      }
    } catch (error) {
      handleError(error);
    }
  }, [handleError, newThread, stopGenerating, supabase, switchThread, threads]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loadedThreads = await listChatThreads(supabase);
        if (cancelled) return;
        setThreads(loadedThreads);
        if (loadedThreads[0]) {
          const first = loadedThreads[0];
          setActiveThreadId(first.id);
          const loadedMessages = await loadChatMessages(supabase, first.id);
          if (!cancelled) setMessages(loadedMessages);
        }
      } catch (error) {
        if (!cancelled) handleError(error);
      } finally {
        if (!cancelled) setIsThreadsLoading(false);
      }
    })();
    return () => { cancelled = true; abortControllerRef.current?.abort(); };
  }, [handleError, setActiveThreadId, setMessages, supabase]);

  const getResponse = useCallback(async (
    payload: ChatRequest,
    assistantLocalId: string,
    userLocalId?: string
  ) => {
    const version = ++requestVersionRef.current;
    abortControllerRef.current = new AbortController();
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: abortControllerRef.current.signal,
    });
    if (!response.ok) throw new Error(`Chat request failed: ${response.status}`);
    if (!response.body) throw new Error("Assistant response did not stream");

    const processor = new StreamProcessor(
      updateMessage,
      setStatus,
      handleError,
      (event) => {
        if (requestVersionRef.current !== version) return;
        setActiveThreadId(event.threadId);
        if (userLocalId && event.userMessageId) replaceMessageId(userLocalId, event.userMessageId);
        upsertThread({
          id: event.thread.id,
          title: event.thread.title,
          createdAt: event.thread.created_at,
          updatedAt: event.thread.updated_at,
        });
      },
      (event) => {
        if (requestVersionRef.current === version) replaceMessageId(assistantLocalId, event.assistantMessageId);
      }
    );
    await processor.processStream(response.body.getReader(), assistantLocalId);
  }, [handleError, replaceMessageId, setActiveThreadId, updateMessage, upsertThread]);

  const handleSubmit = async (event: React.FormEvent, text?: string) => {
    event.preventDefault();
    const content = (text ?? input).trim();
    if (!content || isLoading) return;
    setErrorMessage(null);
    const userMessage: Message = { id: generateUniqueId(), role: "user", content };
    const assistantMessage: Message = { id: generateUniqueId(), role: "assistant", content: "" };
    addMessage(userMessage);
    addMessage(assistantMessage);
    setInput("");
    setIsLoading(true);
    setStatus(null);

    try {
      await getResponse(
        { action: "send", threadId: activeThreadRef.current ?? undefined, content },
        assistantMessage.id,
        userMessage.id
      );
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
      setStatus(null);
      abortControllerRef.current = null;
    }
  };

  const editMessage = async (id: string, content: string) => {
    const threadId = activeThreadRef.current;
    const index = messages.findIndex((message) => message.id === id && message.role === "user");
    if (!threadId || index === -1 || isLoading) return;
    const updated = { ...messages[index], content: content.trim() };
    if (!updated.content) return;
    const assistantMessage: Message = { id: generateUniqueId(), role: "assistant", content: "" };
    setMessages([...messages.slice(0, index), updated, assistantMessage]);
    setIsLoading(true);
    setEditingMessageId(null);
    try {
      await getResponse({ action: "edit", threadId, messageId: id, content: updated.content }, assistantMessage.id);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
      setStatus(null);
      abortControllerRef.current = null;
    }
  };

  const regenerateMessage = async (id: string) => {
    const threadId = activeThreadRef.current;
    const index = messages.findIndex((message) => message.id === id && message.role === "assistant");
    if (!threadId || index === -1 || isLoading) return;
    const assistantMessage: Message = { id: generateUniqueId(), role: "assistant", content: "" };
    setMessages([...messages.slice(0, index), assistantMessage]);
    setIsLoading(true);
    try {
      await getResponse({ action: "regenerate", threadId, messageId: id }, assistantMessage.id);
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
      setStatus(null);
      abortControllerRef.current = null;
    }
  };

  const deleteMessage = useCallback((id: string) => {
    void (async () => {
      try {
        await deletePersistedMessage(supabase, id);
        useChatStore.getState().deleteMessage(id);
      } catch (error) {
        handleError(error);
      }
    })();
  }, [handleError, supabase]);

  return {
    threads,
    activeThreadId,
    isThreadsLoading,
    isLoading,
    status,
    errorMessage,
    clearError: () => setErrorMessage(null),
    editMessage,
    regenerateMessage,
    handleSubmit,
    newThread,
    switchThread,
    deleteThread,
    deleteMessage,
    clearChat: newThread,
    stopGenerating,
    setEditingMessageId,
    editingMessageId,
  };
};
