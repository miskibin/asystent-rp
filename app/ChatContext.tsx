"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useChatLogic } from "@/hooks/useChatLogic";
import type { Message } from "@/lib/types";
import { useChatStore } from "@/lib/store";

interface ChatContextType {
  messages: Message[];
  deleteMessage: (id: string) => void;
  clearMessages: () => void;
  input: string;
  setInput: (input: string) => void;
  isLoading: boolean;
  status: string | null;
  errorMessage: string | null;
  clearError: () => void;
  handleSubmit: (event: React.FormEvent, text?: string) => Promise<void>;
  stopGenerating: () => void;
  editingMessageId: string | null;
  setEditingMessageId: React.Dispatch<React.SetStateAction<string | null>>;
  editMessage: (id: string, content: string) => Promise<void>;
  regenerateMessage: (id: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const chatStore = useChatStore();
  const chatLogic = useChatLogic();
  return <ChatContext.Provider value={{ ...chatStore, ...chatLogic }}>{children}</ChatContext.Provider>;
}

export function useChatContext() {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChatContext must be used within a ChatProvider");
  return context;
}
