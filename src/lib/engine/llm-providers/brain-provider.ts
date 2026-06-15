import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDoubaoBaseUrl, getLlmConfig } from "@/lib/engine/llm-config";
import { extractJsonFromText } from "@/lib/engine/llm-providers/json-utils";

export async function callBrainLlm(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const { brain } = getLlmConfig();

  switch (brain.provider) {
    case "openai":
      return callOpenAiBrain(systemPrompt, userPrompt, brain.model);
    case "claude":
      return callClaudeBrain(systemPrompt, userPrompt, brain.model);
    case "google":
      return callGoogleBrain(systemPrompt, userPrompt, brain.model);
    case "doubao":
      return callDoubaoBrain(systemPrompt, userPrompt, brain.model);
    default:
      throw new Error(`Unsupported brain LLM provider: ${brain.provider}`);
  }
}

async function callOpenAiBrain(
  systemPrompt: string,
  userPrompt: string,
  model: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_tokens: 16384,
    temperature: 0.7,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI brain LLM returned empty response");
  return content;
}

async function callClaudeBrain(
  systemPrompt: string,
  userPrompt: string,
  model: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 16384,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude brain LLM returned empty response");
  }

  return extractJsonFromText(textBlock.text);
}

async function callGoogleBrain(
  systemPrompt: string,
  userPrompt: string,
  model: string
): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not configured");

  const genAI = new GoogleGenerativeAI(apiKey);
  const gemini = genAI.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.7,
    },
  });

  const result = await gemini.generateContent(userPrompt);
  const content = result.response.text();
  if (!content) throw new Error("Google brain LLM returned empty response");
  return extractJsonFromText(content);
}

async function callDoubaoBrain(
  systemPrompt: string,
  userPrompt: string,
  model: string
): Promise<string> {
  const apiKey = process.env.DOUBAO_API_KEY;
  if (!apiKey) throw new Error("DOUBAO_API_KEY is not configured");

  const client = new OpenAI({
    apiKey,
    baseURL: getDoubaoBaseUrl(),
  });

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 16384,
    temperature: 0.7,
  });

  const choice = response.choices[0];
  const content = choice?.message?.content;
  if (!content) throw new Error("Doubao brain LLM returned empty response");

  if (choice?.finish_reason === "length") {
    throw new Error("Doubao brain LLM response was truncated (max_tokens reached)");
  }

  return extractJsonFromText(content);
}
