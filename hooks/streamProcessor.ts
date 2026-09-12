import { Artifact, Message } from "@/lib/types";
type ProgressData =
  | { type: "thread"; threadId: string; thread: { id: string; title: string; created_at: string; updated_at: string }; userMessageId: string | null }
  | { type: "done"; threadId: string; assistantMessageId: string }
  | { type: "status" | "tool_execution" | "response" | "error"; threadId?: string; messages: Message[] };

export class StreamProcessor {
  private decoder = new TextDecoder();
  private buffer = "";
  private currentContent = "";
  private currentArtifacts: Artifact[] = [];
  private currentData: any[] = [];

  constructor(
    private readonly updateMessage: (id: string, message: Message) => void,
    private readonly setStatus: (status: string | null) => void,
    private readonly handleError: (error: unknown) => void,
    private readonly onThread?: (event: Extract<ProgressData, { type: "thread" }>) => void,
    private readonly onDone?: (event: Extract<ProgressData, { type: "done" }>) => void
  ) {}

  private processJsonLine(line: string, messageId: string) {
    if (!line.trim() || !line.startsWith("data: ")) return;

    try {
      const data = JSON.parse(line.slice(6)) as ProgressData;
      if (data.type === "thread") {
        this.onThread?.(data);
        return;
      }
      if (data.type === "done") {
        this.onDone?.(data);
        return;
      }
      if (!data?.messages?.[0]) return;

      const message = data.messages[0];
      switch (data.type) {
        case "status":
          this.setStatus(message.content);
          break;

        case "tool_execution":
          this.setStatus(message.content);
          if (message.artifacts?.length) {
            this.currentArtifacts = [
              ...this.currentArtifacts,
              ...message.artifacts,
            ];
          }
          if (message.data?.length) {
            this.currentData = [...this.currentData, ...message.data];
          }
          this.updateCurrentMessage(messageId);
          break;

        case "response":
          if (message.content) {
            this.currentContent += message.content;
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

        // Append new chunk to existing buffer
        this.buffer += this.decoder.decode(value, { stream: true });

        // Process complete lines from buffer
        let newlineIndex;
        while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
          const line = this.buffer.slice(0, newlineIndex);
          this.buffer = this.buffer.slice(newlineIndex + 1);

          if (line.trim()) {
            this.processJsonLine(line, messageId);
          }
        }
      }

      // Process any remaining data in the buffer
      if (this.buffer.trim()) {
        this.processJsonLine(this.buffer, messageId);
      }

      // Final update with trimmed content
      this.updateCurrentMessage(messageId);
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }
}
