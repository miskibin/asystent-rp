import React, { createContext, useContext, ReactNode, useState } from "react";
import { useChatLogic } from "@/hooks/useChatLogic";
import {
  ChatOptions,
  Model,
  Message,
  Test,
  ResponseMetadata,
} from "@/lib/chat-store";
import { TestResult, useTestLogic } from "@/hooks/useTestLogic";

interface ChatContextType {
  input: string;
  setInput: (input: string) => void;
  messages: Message[];
  isLoading: boolean;
  models: Model[];
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  customSystem: string;
  setCustomSystem: (system: string) => void;
  options: ChatOptions;
  setOptions: React.Dispatch<React.SetStateAction<ChatOptions>>;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  clearChat: () => void;
  stopGenerating: () => void;
  isPdfParsing: boolean;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  responseMetadata: ResponseMetadata | null;
  editMessage: (id: string, newContent: string) => void;
  editingMessageId: string | null;
  setEditingMessageId: React.Dispatch<React.SetStateAction<string | null>>;
  streamResponse: boolean;
  setStreamResponse: (stream: boolean) => void;
  regenerateMessage: (id: string) => Promise<void>;
  fetchModels: () => Promise<void>;
  promptTests: Test[];
  addTest: (test: Test) => void;
  isRunningTest: boolean;
  testResult: TestResult | null;
  runTest: (test: Test, lastModelResponse: string) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const chatLogic = useChatLogic();
  const testLogic = useTestLogic();
  const [promptTests, setPromptTests] = useState<Test[]>([]);
  const addTest = (test: Test) => {
    setPromptTests((prevTests) => [...prevTests, test]);
  };

  return (
    <ChatContext.Provider
      value={{ ...chatLogic, ...testLogic, promptTests, addTest }}
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