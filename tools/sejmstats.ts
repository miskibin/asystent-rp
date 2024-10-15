"use client";
import { ChatOllama } from "@langchain/ollama";
import {
  RunnableSequence,
  RunnablePassthrough,
} from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { SejmStatsCommunicator, SejmStatsResponse } from "./sejmstats-server";
import { PROMPTS } from "./sejmstats-prompts";

const selectField = async (question: string, model: ChatOllama) => {
  const selectedField = await PROMPTS.selectField
    .pipe(model)
    .pipe(new StringOutputParser())
    .invoke({ question });
  return selectedField.trim().toLowerCase();
};

const generateSearchQuery = async (question: string, model: ChatOllama) => {
  const searchQuery = await PROMPTS.generateSearchQuery
    .pipe(model)
    .pipe(new StringOutputParser())
    .invoke({ question });
  // remove _ and * from the question
  return searchQuery.trim().replace(/[_*.\s]/g, "");
};

const processData = async (
  data: any[],
  question: string,
  model: ChatOllama
) => {
  const dataString = JSON.stringify(data);
  const answer = await PROMPTS.processData
    .pipe(model)
    .pipe(new StringOutputParser())
    .invoke({ question, dataString });
  return answer;
};

export const createSejmStatsTool = (
  model: ChatOllama,
  updateMessage: (id: string, content: string, pluginData?: string) => void
) => {
  return RunnableSequence.from([
    new RunnablePassthrough(),
    async ({ question, newMessageId }) => {
      updateMessage(newMessageId, "Rozpoczynanie wyboru pola...");
      const field = await selectField(question, model);
      console.log("Selected field:", field);

      updateMessage(
        newMessageId,
        `Wybrane pole: ${field}. Generowanie zapytania...`
      );
      const searchQuery = await generateSearchQuery(question, model);
      console.log("Generated search query:", searchQuery);

      updateMessage(
        newMessageId,
        `Zapytanie: ${searchQuery}. Wysyłanie zapytania...`
      );
      const communicator = new SejmStatsCommunicator();
      const data = await communicator.searchOptimized(searchQuery, field);
      console.log("Received data:", data);

      updateMessage(newMessageId, "Przetwarzanie danych...");
      const answer = await processData(data, question, model);

      updateMessage(newMessageId, JSON.stringify(data, null, 2));

      return answer;
    },
    new StringOutputParser(),
  ]);
};
