import {
  BaseMessage,
  AIMessage,
  ChatMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { StructuredToolInterface } from "@langchain/core/tools";
import { FirstIrrelevantUserQuestion, PROMPTS } from "./prompts";
import { LoggerService } from "./logger";
import { Artifact } from "@/lib/types";
import { AbstractLLM } from "./llms/LLM";

interface AgentProgress {
  type: "status" | "tool_execution" | "response";
  content: string;
  artifacts?: Artifact[];
}

interface AgentOptions {
  llm: AbstractLLM;
  tools: StructuredToolInterface[];
  verbose?: boolean;
}

export class AgentRP {
  private llm: AbstractLLM;
  private tools: StructuredToolInterface[];
  private logger: LoggerService;

  constructor(options: AgentOptions) {
    this.llm = options.llm;
    this.tools = options.tools;
    this.logger = new LoggerService(process.env.NODE_ENV === "development");
  }

  private async analyzeToolRelevance(
    query: string,
    tool: StructuredToolInterface,
    messages: ChatMessage[]
  ): Promise<boolean> {
    this.logger.debug(`Analyzing relevance for tool: ${tool.name}`);

    // Skip system message and only use user messages for relevance check
    const userMessages = messages.filter(
      (msg) => msg instanceof SystemMessage === false
    );
    const lastAIResponse = userMessages
      .slice()
      .reverse()
      .find((msg) => msg instanceof AIMessage || msg.role === "assistant");

    const prompt = await PROMPTS.analyzeToolRelevance.format({
      query,
      toolDescription: tool.description,
      previousResponse: lastAIResponse ? lastAIResponse.content : "",
    });

    // Create a new message with the formatted prompt
    const promptMessage = new ChatMessage({
      role: "user",
      content: prompt,
    });

    let response = "";

    for await (const chunk of this.llm.run([promptMessage], {})) {
      response += chunk.text;
    }

    const lines = response.split("\n");
    const relevantLine =
      lines.find((line) => line.startsWith("RELEVANT:"))?.trim() || "";
    return relevantLine.includes("YES");
  }

  private async analyzeQuery(
    query: string,
    messages: ChatMessage[]
  ): Promise<string[]> {
    const relevantTools: string[] = [];

    for (const tool of this.tools) {
      const isRelevant = await this.analyzeToolRelevance(query, tool, messages);
      if (isRelevant) {
        relevantTools.push(tool.name);
      }
    }

    return relevantTools;
  }

  private async executeTool(
    tool: StructuredToolInterface,
    userMessage: ChatMessage
  ): Promise<{ result: string; artifact?: Artifact }> {
    try {
      const rawResult = await tool.invoke({ question: userMessage.content });
      const result = rawResult.toString();

      try {
        const parsed = JSON.parse(result);
        if (parsed.artifact) {
          return {
            result: parsed.result || result,
            artifact: parsed.artifact,
          };
        }
      } catch (e) {
        // Not JSON or no artifact, return raw result
      }

      return { result };
    } catch (e) {
      return { result: `Error: Failed to execute tool ${tool.name}` };
    }
  }

  private async *processWithoutTools(
    messages: ChatMessage[]
  ): AsyncGenerator<string> {
    if (messages.length < 3) {
      yield FirstIrrelevantUserQuestion;
      return;
    }

    // Get last 3 messages including artifacts
    const lastThreeMessages = messages.slice(-3);
    // Stream the response using the run method
    for await (const chunk of this.llm.run(lastThreeMessages, {})) {
      yield chunk.text;
    }
  }

  async *invoke(messages: ChatMessage[]): AsyncGenerator<AgentProgress> {
    // Dataflow
    // If tool is enabled, check if it is relevant to the query
    // If tool is relevant, execute the tool and then set the chatMessage artifact to the result, then run final prompt with user question and chatMessage
    // If tool is not relevant, run last 3 messages through the LLM (But with only latest 1 artifact.)
    const systemMessage = messages[0] as SystemMessage;
    const userMessage = messages[messages.length - 1];

    yield {
      type: "status",
      content: "Analizuję zapytanie...",
    };

    const relevantToolNames = await this.analyzeQuery(
      userMessage.content as string,
      messages
    );

    if (relevantToolNames.length === 0) {
      yield {
        type: "status",
        content: "Generuję odpowiedź na podstawie kontekstu...",
      };

      for await (const chunk of this.processWithoutTools(messages)) {
        yield {
          type: "response",
          content: chunk,
        };
      }
      return;
    }

    if (relevantToolNames.length > 0) {
      yield {
        type: "status",
        content: `Postanowiłem użyć ${
          relevantToolNames.length
        } narzędzi: ${relevantToolNames.join(", ")}`,
      };
    }

    const toolResults = [];
    const artifacts: Artifact[] = [];

    for (const toolName of relevantToolNames) {
      const tool = this.tools.find((t) => t.name === toolName);
      if (!tool) continue;

      yield {
        type: "status",
        content: `Czekam na odpowiedź od ${toolName}...`,
      };

      const { result, artifact } = await this.executeTool(tool, userMessage);

      if (artifact) {
        artifacts.push(artifact);
      }

      toolResults.push({
        tool: toolName,
        result,
      });

      yield {
        type: "tool_execution",
        content: `Wykonanie narzędzia ${toolName} zakończone`,
        artifacts: artifact ? [artifact] : undefined,
      };
    }

    const formattedResults = toolResults
      .map((r) => `${r.tool}: ${r.result}`)
      .join("\n");

    yield {
      type: "status",
      content: "Generuję ostateczną odpowiedź...",
    };

    const finalPrompt = await PROMPTS.processDataPrompt.format({
      question: userMessage.content,
    });

    // Create final messages with proper artifact handling
    const finalMessages = [
      new ChatMessage({
        role: "system",
        content: systemMessage.content,
      }),
      new ChatMessage({
        role: "user",
        content: finalPrompt,
        additional_kwargs: {
          artifacts: formattedResults,
        },
      }),
    ];

    for await (const chunk of this.llm.run(finalMessages, {})) {
      yield {
        type: "response",
        content: chunk.text,
        artifacts: artifacts,
      };
    }
  }

  async call(
    input: string | ChatMessage[]
  ): Promise<{ content: string; artifacts: Artifact[] }> {
    let messages: ChatMessage[];
    if (typeof input === "string") {
      messages = [new ChatMessage({ role: "user", content: input })];
    } else {
      messages = input;
    }

    let lastContent = "";
    let allArtifacts: Artifact[] = [];

    for await (const progress of this.invoke(messages)) {
      if (progress.type === "response") {
        lastContent += progress.content;
        if (progress.artifacts) {
          allArtifacts = progress.artifacts;
        }
      }
    }

    if (!lastContent) {
      throw new Error("Nie wygenerowano odpowiedzi");
    }

    return {
      content: lastContent,
      artifacts: allArtifacts,
    };
  }
}
