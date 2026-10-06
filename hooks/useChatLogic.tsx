import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "./use-toast";
import { StreamProcessor } from "./streamProcessor";
import {
  deleteChatThread, deletePersistedMessage, listChatThreads, loadChatMessages,
  updateChatThread, reorderChatThreads, sortChatThreads, type ChatThread,
} from "@/lib/chat-persistence";
import { chatRequestSchema, type ChatDocument } from "@/lib/chat-request";
import type { z } from "zod";
import type { Message } from "@/lib/types";
import { createClientComponentClient } from "@/lib/supabase/client";
import { generateUniqueId } from "@/utils/common";
import { useChatStore } from "@/lib/store";

type ChatRequest = z.infer<typeof chatRequestSchema>;

export const useChatLogic = () => {
  const { addMessage, setMessages, updateMessage, replaceMessageId, clearMessages, setInput } = useChatStore();
  const supabase = useMemo(() => createClientComponentClient(), []);
  const { toast } = useToast();
  const controllerRef = useRef<AbortController | null>(null);
  const versionRef = useRef(0);
  const activeRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const conversationCache = useRef(new Map<string, Message[]>());
  const loadedThreadRef = useRef<string | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadIdState] = useState<string | null>(null);
  const [isThreadsLoading, setIsThreadsLoading] = useState(true);
  const [isConversationLoading, setIsConversationLoading] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const setActiveThreadId = useCallback((id: string | null) => {
    activeRef.current = id;
    setActiveThreadIdState(id);
  }, []);
  const handleError = useCallback((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") return;
    const message = error instanceof Error ? error.message : "Nie udało się wykonać operacji.";
    setErrorMessage(message);
    toast({ title: "Operacja nie powiodła się", description: message, variant: "destructive" });
  }, [toast]);
  const stopGenerating = useCallback(() => {
    versionRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    busyRef.current = false;
    setIsLoading(false);
    setStatus(null);
  }, []);
  const upsertThread = useCallback((thread: ChatThread) => {
    setThreads((current) => sortChatThreads([thread, ...current.filter((item) => item.id !== thread.id)]).slice(0, 50));
  }, []);
  const switchThread = useCallback(async (threadId: string) => {
    if (activeRef.current === threadId) return;
    if (activeRef.current) {
      if (busyRef.current) conversationCache.current.delete(activeRef.current);
      else if (loadedThreadRef.current === activeRef.current) conversationCache.current.set(activeRef.current, useChatStore.getState().messages);
    }
    stopGenerating();
    const version = ++versionRef.current;
    setActiveThreadId(threadId);
    const cached = conversationCache.current.get(threadId);
    loadedThreadRef.current = cached ? threadId : null;
    setIsConversationLoading(!cached);
    setErrorMessage(null);
    setEditingMessageId(null);
    setMessages(cached ?? []);
    if (cached) return;
    try {
      const loaded = await loadChatMessages(supabase, threadId);
      if (versionRef.current === version) {
        loadedThreadRef.current = threadId;
        conversationCache.current.set(threadId, loaded);
        setMessages(loaded);
      }
    } catch (error) {
      if (versionRef.current === version) handleError(error);
    } finally {
      if (versionRef.current === version) setIsConversationLoading(false);
    }
  }, [handleError, setActiveThreadId, setMessages, stopGenerating, supabase]);
  const newThread = useCallback(() => {
    if (activeRef.current) {
      if (busyRef.current) conversationCache.current.delete(activeRef.current);
      else if (loadedThreadRef.current === activeRef.current) conversationCache.current.set(activeRef.current, useChatStore.getState().messages);
    }
    stopGenerating();
    loadedThreadRef.current = null;
    setActiveThreadId(null);
    setIsConversationLoading(false);
    setEditingMessageId(null);
    clearMessages();
    setInput("");
    setErrorMessage(null);
  }, [clearMessages, setActiveThreadId, setInput, stopGenerating]);

  useEffect(() => {
    let cancelled = false;
    const version = versionRef.current;
    void (async () => {
      try {
        const loaded = await listChatThreads(supabase);
        if (cancelled) return;
        setThreads(loaded);
        if (versionRef.current === version && loaded[0]) await switchThread(loaded[0].id);
      } catch (error) {
        if (!cancelled) handleError(error);
      } finally {
        if (!cancelled) setIsThreadsLoading(false);
      }
    })();
    return () => { cancelled = true; controllerRef.current?.abort(); };
  }, [handleError, supabase, switchThread]);

  const run = useCallback(async (payload: ChatRequest, assistantId: string, userId?: string) => {
    const version = ++versionRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    busyRef.current = true;
    setIsLoading(true);
    setStatus("Przygotowuję odpowiedź…");
    setErrorMessage(null);
    let succeeded = false;
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      if (!response.ok) throw new Error(response.status === 401 ? "Zaloguj się ponownie." : "Nie udało się rozpocząć odpowiedzi.");
      if (!response.body) throw new Error("Nie otrzymano strumienia odpowiedzi.");
      const current = () => versionRef.current === version;
      const processor = new StreamProcessor(
        (id, message) => { if (current()) updateMessage(id, message); },
        (next) => { if (current()) setStatus(next); },
        (error) => { if (current()) handleError(error); },
        (event) => {
          if (!current()) return;
          setActiveThreadId(event.threadId);
          loadedThreadRef.current = event.threadId;
          if (userId && event.userMessageId) replaceMessageId(userId, event.userMessageId);
          upsertThread({ id: event.thread.id, title: event.thread.title,
            createdAt: event.thread.created_at, updatedAt: event.thread.updated_at,
            pinned: Boolean(event.thread.pinned), sortOrder: Number(event.thread.sort_order ?? 0) });
        },
        (event) => {
          if (!current()) return;
          succeeded = true;
          replaceMessageId(assistantId, event.assistantMessageId);
        },
      );
      await processor.processStream(response.body.getReader(), assistantId);
      if (!controller.signal.aborted && !succeeded) throw new Error("Odpowiedź została przerwana. Spróbuj ponownie.");
    } catch (error) {
      if (versionRef.current === version) handleError(error);
    } finally {
      if (versionRef.current === version) {
        setIsLoading(false); setStatus(null); controllerRef.current = null; busyRef.current = false;
      }
    }
    return succeeded;
  }, [handleError, replaceMessageId, setActiveThreadId, updateMessage, upsertThread]);

  const handleSubmit = useCallback(async (event: React.FormEvent, text?: string, documents: ChatDocument[] = []) => {
    event.preventDefault();
    const state = useChatStore.getState();
    if (busyRef.current || isConversationLoading || isThreadsLoading) return false;
    const result = chatRequestSchema.safeParse({ action: "send", threadId: activeRef.current ?? undefined,
      content: (text ?? state.input).trim(), documents });
    if (!result.success) { handleError(new Error("Wiadomość: maks. 4000 znaków. Załączniki: do 3 plików tekstowych, łącznie 12000 znaków.")); return false; }
    const user = { id: generateUniqueId(), role: "user" as const, content: result.data.action === "send" ? result.data.content : "", documents };
    const assistant = { id: generateUniqueId(), role: "assistant" as const, content: "" };
    addMessage(user); addMessage(assistant); setInput("");
    return run(result.data, assistant.id, user.id);
  }, [addMessage, handleError, isConversationLoading, isThreadsLoading, run, setInput]);

  const editMessage = useCallback(async (id: string, content: string) => {
    const state = useChatStore.getState();
    const index = state.messages.findIndex((message) => message.id === id && message.role === "user");
    if (!activeRef.current || index < 0 || busyRef.current) return;
    const parsed = chatRequestSchema.safeParse({ action: "edit", threadId: activeRef.current, messageId: id, content });
    if (!parsed.success) { handleError(new Error("Podaj od 1 do 4000 znaków.")); return; }
    const assistant: Message = { id: generateUniqueId(), role: "assistant", content: "" };
    setMessages([...state.messages.slice(0, index), { ...state.messages[index], content: content.trim() }, assistant]);
    setEditingMessageId(null);
    await run(parsed.data, assistant.id);
  }, [handleError, run, setMessages]);
  const regenerateMessage = useCallback(async (id: string) => {
    const state = useChatStore.getState();
    const index = state.messages.findIndex((message) => message.id === id && message.role === "assistant");
    if (!activeRef.current || index < 0 || busyRef.current) return;
    const assistant: Message = { id: generateUniqueId(), role: "assistant", content: "" };
    setMessages([...state.messages.slice(0, index), assistant]);
    await run({ action: "regenerate", threadId: activeRef.current, messageId: id }, assistant.id);
  }, [run, setMessages]);
  const deleteMessage = useCallback((id: string) => {
    if (busyRef.current) return;
    void deletePersistedMessage(supabase, id).then(() => useChatStore.getState().deleteMessage(id)).catch(handleError);
  }, [handleError, supabase]);
  const deleteThreads = useCallback(async (ids: string[]) => {
    if (ids.includes(activeRef.current ?? "")) newThread();
    try {
      const { error } = await supabase.from("chat_threads").delete().in("id", ids);
      if (error) throw error;
      for (const id of ids) conversationCache.current.delete(id);
      setThreads((current) => current.filter((thread) => !ids.includes(thread.id)));
    } catch (error) { handleError(error); }
  }, [handleError, newThread, supabase]);
  const deleteThread = useCallback(async (id: string) => {
    if (activeRef.current === id) newThread();
    try { await deleteChatThread(supabase, id); conversationCache.current.delete(id); setThreads((current) => current.filter((thread) => thread.id !== id)); }
    catch (error) { handleError(error); }
  }, [handleError, newThread, supabase]);
  const renameThread = useCallback(async (id: string, title: string) => {
    try { await updateChatThread(supabase, id, { title }); setThreads((current) => current.map((thread) => thread.id === id ? { ...thread, title: title.trim().slice(0, 120) } : thread)); }
    catch (error) { handleError(error); }
  }, [handleError, supabase]);
  const pinThreads = useCallback(async (ids: string[], pinned: boolean) => {
    try {
      const { error } = await supabase.from("chat_threads").update({ pinned }).in("id", ids);
      if (error) throw error;
      setThreads((current) => sortChatThreads(current.map((thread) => ids.includes(thread.id) ? { ...thread, pinned } : thread)));
    } catch (error) { handleError(error); }
  }, [handleError, supabase]);
  const reorderThreads = useCallback(async (ids: string[]) => {
    try {
      await reorderChatThreads(supabase, ids);
      setThreads((current) => sortChatThreads(current.map((thread) => ({ ...thread, sortOrder: ids.includes(thread.id) ? ids.indexOf(thread.id) + 1 : thread.sortOrder }))));
    } catch (error) { handleError(error); }
  }, [handleError, supabase]);

  return { threads, activeThreadId, isThreadsLoading, isConversationLoading, isLoading, status, errorMessage,
    clearError: () => setErrorMessage(null), editMessage, regenerateMessage, handleSubmit, newThread,
    switchThread, deleteThread, deleteThreads, renameThread, pinThreads, reorderThreads, deleteMessage,
    clearChat: newThread, stopGenerating, setEditingMessageId, editingMessageId };
};
