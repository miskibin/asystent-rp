export type ChatToolStep = {
  id: string;
  name: string;
  status?: "pending" | "running" | "done" | "error";
  input?: string;
  output?: string;
};

export type ChatMessagePart =
  | { type: "thinking"; id: string; text: string }
  | { type: "text"; id: string; text: string }
  | { type: "tool"; id: string; tool: ChatToolStep };

export type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  parts?: ChatMessagePart[];
  tools?: ChatToolStep[];
  workedFor?: number;
  artifacts?: Artifact[];
  data?: any[];
};

export interface ActResponse {
  act_url: string;
  act_title: string;
  summary: string;
  content: string;
  chapters: string;
  act_announcement_date: string;
  similarity_score: number;
}

export function isActResponse(obj: any): obj is ActResponse {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof obj.act_url === "string" &&
    typeof obj.act_title === "string" &&
    typeof obj.summary === "string" &&
    typeof obj.content === "string" &&
    typeof obj.chapters === "string" &&
    typeof obj.act_announcement_date === "string" &&
    typeof obj.similarity_score === "number"
  );
}

export interface Artifact {
  type: string;
  question: string;
  searchQuery: string;
  data: any;
}

export type Model = {
  name: string;
  short: string;
  description: string;
};

export type SummarableText = {
  title: string;
  summary: string;
  text_length: number;
  url: string;
  similarity: number;
};

export type ChatPlugin = {
  enabled: boolean;
  name: string;
};

export type ChatOptions = {
  temperature: number;
  topP: number;
  seed?: number;
  topK: number;
  streaming: boolean;
  repeatPenalty: number;
  maxTokens?: number;
};
