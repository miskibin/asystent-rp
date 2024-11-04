import { useRef, useState } from "react";
import { Artifact, Message } from "@/lib/types";
import { generateUniqueId } from "@/utils/common";
import { useChatStore } from "@/lib/store";
import { checkEasterEggs } from "@/lib/utils";
import { useToast } from "./use-toast";
import { useMessageLimits } from "@/lib/prompt-tracking";
import { StreamProcessor } from "./streamProcessor";

export const useChatLogic = () => {
  const {
    messages,
    addMessage,
    updateMessage,
    clearMessages,
    options,
    systemPrompt,
    setSystemPrompt,
    input,
    setInput,
    selectedModel,
    setSelectedModel,
    plugins,
    clearMemory,
  } = useChatStore();

  const { toast } = useToast();
  const { checkMessageLimits } = useMessageLimits(selectedModel);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleError = (error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") return;

    const errorMessage =
      error instanceof Error ? error.message : "An unknown error occurred";
    const errorSource =
      error instanceof Error && error.stack
        ? error.stack.split("\n")[1]?.trim() || "Unknown location"
        : "Unknown location";

    toast({
      title: "Błąd podczas odpowiadania",
      description: `Location: ${errorSource}\nError: ${errorMessage}`,
      variant: "destructive",
      duration: 5000,
    });
  };

  const getResponse = async (messageHistory: Message[]) => {
    setIsLoading(true);
    setStatus(null);
    abortControllerRef.current = new AbortController();

    const newMessageId = generateUniqueId();
    addMessage({
      id: newMessageId,
      role: "assistant",
      content: "",
      artifacts: [],
      data: [],
    });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messageHistory,
          systemPrompt,
          enabledPluginIds: plugins.filter((p) => p.enabled).map((p) => p.name),
          modelName: selectedModel,
          options,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (response.body) {
        const streamProcessor = new StreamProcessor(
          updateMessage,
          setStatus,
          handleError
        );
        await streamProcessor.processStream(
          response.body.getReader(),
          newMessageId
        );
      }
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
      setStatus(null);
      abortControllerRef.current = null;
    }
  };

  const handleSubmit = async (e: React.FormEvent, text?: string) => {
    e.preventDefault();
    const inputText = text || input;
    if (!inputText.trim()) return;

    const isPaidModel = !selectedModel.includes("free");
    const { canSendMessage, shouldSwitchModel, message } =
      await checkMessageLimits(isPaidModel);

    if (!canSendMessage) {
      toast({
        title: "Limit wiadomości",
        description: message,
        variant: "destructive",
        duration: 5000,
      });
      return;
    }

    if (shouldSwitchModel) {
      setSelectedModel("meta-llama/Llama-Vision-Free");
      toast({
        title: "Limit wiadomości osiągnięty",
        description: message,
        duration: 5000,
      });
    }

    const userMessage: Message = {
      id: generateUniqueId(),
      role: "user",
      content: inputText,
      artifacts: [],
    };

    addMessage(userMessage);
    setInput("");

    try {
      const easterEgg = checkEasterEggs(inputText);
      if (easterEgg) {
        setIsLoading(true);
        await new Promise((resolve) => setTimeout(resolve, 400));
        addMessage({
          id: generateUniqueId(),
          role: "assistant",
          content: `![Easter Egg](${easterEgg})`,
          artifacts: [],
        });
      } else {
        await getResponse([...messages, userMessage]);
      }
    } catch (error) {
      handleError(error);
    } finally {
      setIsLoading(false);
    }
  };

  const editMessage = async (id: string, newContent: string) => {
    const messageIndex = messages.findIndex((msg) => msg.id === id);
    if (messageIndex === -1) return;

    const updatedMessage = { ...messages[messageIndex], content: newContent };

    if (updatedMessage.role === "user") {
      const newMessages = messages
        .slice(0, messageIndex + 1)
        .map((msg) => (msg.id === id ? updatedMessage : msg));
      clearMessages();
      newMessages.forEach(addMessage);
      await getResponse(newMessages);
    } else {
      updateMessage(id, updatedMessage);
    }

    setEditingMessageId(null);
  };

  const regenerateMessage = async (id: string) => {
    const messageIndex = messages.findIndex((msg) => msg.id === id);
    if (messageIndex === -1 || messages[messageIndex].role !== "assistant")
      return;

    const previousMessages = messages.slice(0, messageIndex);
    clearMessages();
    previousMessages.forEach(addMessage);
    await getResponse(previousMessages);
  };

  return {
    isLoading,
    status,
    editMessage,
    customSystem: systemPrompt,
    setCustomSystem: setSystemPrompt,
    regenerateMessage,
    handleSubmit,
    clearChat: () => {
      clearMessages();
      clearMemory();
    },
    stopGenerating: () => {
      abortControllerRef.current?.abort();
      setIsLoading(false);
    },
    setEditingMessageId,
    editingMessageId,
  };
};
