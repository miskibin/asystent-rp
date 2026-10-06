"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useChatLogic } from "@/hooks/useChatLogic";
import { useChatStore } from "@/lib/store";

type ChatContextType = ReturnType<typeof useChatLogic> & ReturnType<typeof useChatStore.getState>;

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
