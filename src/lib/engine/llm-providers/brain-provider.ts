import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  getBrainDoubaoBaseUrl,
  getLlmConfig,
  requireBrainApiKey,
} from "@/lib/engine/llm-config";
import { extractJsonFromText } from "@/lib/engine/llm-providers/json-utils";

export interface BrainLlmStreamOptions {
  onChunk?: (text: string) => void | Promise<void>;
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Generation cancelled", "AbortError");
  }
}

export async function callBrainLlm(
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal
): Promise<string> {
  return callBrainLlmStream(systemPrompt, userPrompt, { signal });
}

export async function callBrainLlmStream(
  systemPrompt: string,
  userPrompt: string,
  options: BrainLlmStreamOptions = {}
): Promise<string> {
  const { brain } = getLlmConfig();
  throwIfAborted(options.signal);

  switch (brain.provider) {
    case "openai":
      return callOpenAiBrainStream(systemPrompt, userPrompt, brain.model, options);
    case "claude":
      return callClaudeBrainStream(systemPrompt, userPrompt, brain.model, options);
    case "google":
      return callGoogleBrainStream(systemPrompt, userPrompt, brain.model, options);
    case "doubao":
      return callDoubaoBrainStream(systemPrompt, userPrompt, brain.model, options);
    default:
      throw new Error(`Unsupported brain LLM provider: ${brain.provider}`);
  }
}

async function emitChunk(
  options: BrainLlmStreamOptions,
  text: string,
  full: { value: string }
): Promise<void> {
  if (!text) return;
  full.value += text;
  await options.onChunk?.(text);
}

async function callOpenAiBrainStream(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  options: BrainLlmStreamOptions
): Promise<string> {
  const apiKey = requireBrainApiKey("openai");
  const client = new OpenAI({ apiKey });
  const full = { value: "" };

  const stream = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_tokens: 16384,
    temperature: 0.7,
    stream: true,
  });

  for await (const chunk of stream) {
    throwIfAborted(options.signal);
    await emitChunk(options, chunk.choices[0]?.delta?.content || "", full);
  }

  if (!full.value) throw new Error("OpenAI brain LLM returned empty response");
  return full.value;
}

async function callClaudeBrainStream(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  options: BrainLlmStreamOptions
): Promise<string> {
  const apiKey = requireBrainApiKey("claude");
  const client = new Anthropic({ apiKey });
  const full = { value: "" };

  const stream = client.messages.stream({
    model,
    max_tokens: 16384,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  for await (const event of stream) {
    throwIfAborted(options.signal);
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      await emitChunk(options, event.delta.text, full);
    }
  }

  if (!full.value) throw new Error("Claude brain LLM returned empty response");
  return extractJsonFromText(full.value);
}

async function callGoogleBrainStream(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  options: BrainLlmStreamOptions
): Promise<string> {
  const apiKey = requireBrainApiKey("google");
  const genAI = new GoogleGenerativeAI(apiKey);
  const gemini = genAI.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.7,
    },
  });

  const result = await gemini.generateContentStream(userPrompt);
  const full = { value: "" };

  for await (const chunk of result.stream) {
    throwIfAborted(options.signal);
    await emitChunk(options, chunk.text(), full);
  }

  if (!full.value) throw new Error("Google brain LLM returned empty response");
  return extractJsonFromText(full.value);
}

async function callDoubaoBrainStream(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  options: BrainLlmStreamOptions
): Promise<string> {
  const apiKey = requireBrainApiKey("doubao");
  const client = new OpenAI({
    apiKey,
    baseURL: getBrainDoubaoBaseUrl(),
  });
  const full = { value: "" };

  const stream = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 16384,
    temperature: 0.7,
    stream: true,
  });

  for await (const chunk of stream) {
    throwIfAborted(options.signal);
    await emitChunk(options, chunk.choices[0]?.delta?.content || "", full);
  }

  if (!full.value) throw new Error("Doubao brain LLM returned empty response");
  return extractJsonFromText(full.value);
}
