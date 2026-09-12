import type {
  Artifact,
  ChatMessagePart,
  ChatToolStep,
  Message,
} from "@/lib/types";

type ThreadEvent = {
  type: "thread";
  threadId: string;
  thread: { id: string; title: string; created_at: string; updated_at: string };
  userMessageId: string | null;
};

type DoneEvent = {
  type: "done";
  threadId: string;
  assistantMessageId: string;
  workedFor?: number;
};

type ProgressData =
  | ThreadEvent
  | DoneEvent
  | { type: "tool_start" | "tool_update" | "tool_end"; threadId: string; tool: ChatToolStep }
  | { type: "status" | "tool_execution" | "response" | "error"; threadId?: string; messages: Message[] };

export class StreamProcessor {
  private decoder = new TextDecoder();
  private buffer = "";
  private currentContent = "";
  private currentArtifacts: Artifact[] = [];
  private currentData: any[] = [];
  private currentParts: ChatMessagePart[] = [];
  private partSequence = 0;
  private workedFor: number | undefined;

  constructor(
    private readonly updateMessage: (id: string, message: Message) => void,
    private readonly setStatus: (status: string | null) => void,
    private readonly handleError: (error: unknown) => void,
    private readonly onThread?: (event: ThreadEvent) => void,
    private readonly onDone?: (event: DoneEvent) => void
  ) {}

  private appendText(content: string) {
    this.currentContent += content;
    const last = this.currentParts.at(-1);
    if (last?.type === "text") {
      last.text += content;
      return;
    }
    this.currentParts.push({
      type: "text",
      id: `text-part-${this.partSequence++}`,
      text: content,
    });
  }

  private upsertTool(tool: ChatToolStep) {
    const index = this.currentParts.findIndex(
      (part) => part.type === "tool" && part.tool.id === tool.id
    );
    if (index >= 0) {
      const current = this.currentParts[index];
      if (current.type === "tool") {
        this.currentParts[index] = {
          ...current,
          tool: { ...current.tool, ...tool },
        };
      }
      return;
    }
    this.currentParts.push({
      type: "tool",
      id: `tool-part-${this.partSequence++}`,
      tool,
    });
  }

  private processJsonLine(line: string, messageId: string) {
    if (!line.trim() || !line.startsWith("data: ")) return;

    try {
      const data = JSON.parse(line.slice(6)) as ProgressData;

      if (data.type === "thread") {
        this.onThread?.(data);
        return;
      }
      if (data.type === "done") {
        this.workedFor = data.workedFor;
        this.updateCurrentMessage(messageId);
        this.onDone?.(data);
        return;
      }
      if (
        data.type === "tool_start" ||
        data.type === "tool_update" ||
        data.type === "tool_end"
      ) {
        this.upsertTool(data.tool);
        this.setStatus(
          data.type === "tool_end" ? "Przygotowuję odpowiedź…" : data.tool.name
        );
        this.updateCurrentMessage(messageId);
        return;
      }
      if (!("messages" in data) || !data.messages?.[0]) return;

      const message = data.messages[0];
      switch (data.type) {
        case "status":
          this.setStatus(message.content);
          break;

        case "tool_execution":
          this.setStatus(message.content);
          if (message.artifacts?.length) {
            this.currentArtifacts = [...this.currentArtifacts, ...message.artifacts];
          }
          if (message.data?.length) {
            this.currentData = [...this.currentData, ...message.data];
          }
          this.updateCurrentMessage(messageId);
          break;

        case "response":
          if (message.content) {
            this.appendText(message.content);
            this.updateCurrentMessage(messageId);
          }
          break;

        case "error":
          if (message.content) throw new Error(message.content);
          break;
      }
    } catch (error) {
      console.error("Error processing stream chunk:", error);
      this.handleError(error);
    }
  }

  private updateCurrentMessage(messageId: string) {
    this.updateMessage(messageId, {
      id: messageId,
      role: "assistant",
      content: this.currentContent,
      parts: this.currentParts.length > 0 ? [...this.currentParts] : undefined,
      workedFor: this.workedFor,
      artifacts: this.currentArtifacts,
      data: this.currentData,
    });
  }

  async processStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    messageId: string
  ) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        this.buffer += this.decoder.decode(value, { stream: true });
        let newlineIndex;
        while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
          const line = this.buffer.slice(0, newlineIndex);
          this.buffer = this.buffer.slice(newlineIndex + 1);
          if (line.trim()) this.processJsonLine(line, messageId);
        }
      }

      if (this.buffer.trim()) this.processJsonLine(this.buffer, messageId);
      this.updateCurrentMessage(messageId);
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }
}