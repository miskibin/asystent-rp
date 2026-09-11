import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatOptions, ChatPlugin, Message, Model } from "./types";

interface ChatState {
  messages: Message[];
  options: ChatOptions;
  systemPrompt: string;
  input: string;
  plugins: ChatPlugin[];
  patrons: string[];
  models: Model[];
  selectedModel: string;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, message: Message) => void;
  deleteMessage: (id: string) => void;
  clearMessages: () => void;
  setOptions: (options: Partial<ChatOptions>) => void;
  setSystemPrompt: (prompt: string) => void;
  setInput: (input: string) => void;
  setPlugins: (plugins: ChatPlugin[]) => void;
  togglePlugin: (name: string) => void;
  clearMemory: () => void;
  setPatrons: (patrons: string[]) => void;
  setModels: (models: Model[]) => void;
  setSelectedModel: (model: string) => void;
}

const model: Model = {
  name: "deepseek-flash",
  short: "DeepSeek V4 Flash",
  description: "thinking wyłączone",
};

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      options: {
        temperature: 0.3,
        topP: 0.8,
        streaming: true,
        topK: 40,
        repeatPenalty: 1.1,
        maxTokens: 1024,
      },
      systemPrompt: "",
      input: "",
      plugins: [],
      patrons: [],
      models: [model],
      selectedModel: model.name,
      addMessage: (message) =>
        set((state) => ({
          messages: [...state.messages, { ...message, artifacts: message.artifacts || [] }],
        })),
      updateMessage: (id, updatedMessage) =>
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === id
              ? {
                  ...updatedMessage,
                  artifacts: updatedMessage.artifacts || message.artifacts,
                  data: updatedMessage.data || message.data,
                }
              : message
          ),
        })),
      deleteMessage: (id) =>
        set((state) => ({ messages: state.messages.filter((message) => message.id !== id) })),
      clearMessages: () => set({ messages: [] }),
      setOptions: (options) => set((state) => ({ options: { ...state.options, ...options } })),
      setSystemPrompt: () => set({ systemPrompt: "" }),
      setInput: (input) => set({ input }),
      setPlugins: () => set({ plugins: [] }),
      togglePlugin: () => undefined,
      clearMemory: () => undefined,
      setPatrons: (patrons) => set({ patrons }),
      setModels: () => set({ models: [model] }),
      setSelectedModel: () => set({ selectedModel: model.name }),
    }),
    {
      name: "chat-storage",
      partialize: (state) => ({
        messages: state.messages,
        options: state.options,
      }),
    }
  )
);
