"use client";
import React, { createContext, useContext, ReactNode, useState } from "react";
import { useChatLogic } from "@/hooks/useChatLogic";
import { ChatOptions, Message, ChatPlugin } from "@/lib/types";
import { useChatStore } from "@/lib/store";

interface ChatContextType {
  // From useChatStore
  messages: Message[];
  addMessage: (message: Message) => void;
  updateMessage: (id: string, message: Message) => void;
  editMessage: (id: string, content: string) => void;
  deleteMessage: (id: string) => void;
  clearMessages: () => void;
  options: ChatOptions;
  setOptions: (options: Partial<ChatOptions>) => void;
  systemPrompt: string;
  setSystemPrompt: (prompt: string) => void;
  input: string;
  setInput: (input: string) => void;
  plugins: ChatPlugin[];
  // From useChatLogic
  isLoading: boolean;
  status: string | null;
  handleSubmit: (e: React.FormEvent, text?: string) => Promise<void>;
  stopGenerating: () => void;
  editingMessageId: string | null;
  setEditingMessageId: React.Dispatch<React.SetStateAction<string | null>>;
  regenerateMessage: (id: string) => Promise<void>;
  // Local state
  isPromptDialogOpen: boolean;
  setIsPromptDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  togglePlugin: (name: string) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const chatStore = useChatStore();
  const chatLogic = useChatLogic();
  const [isPromptDialogOpen, setIsPromptDialogOpen] = useState(false);

  return (
    <ChatContext.Provider
      value={{
        ...chatStore,
        ...chatLogic,
        isPromptDialogOpen,
        setIsPromptDialogOpen,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChatContext = () => {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useChatContext must be used within a ChatProvider");
  }
  return context;
};
