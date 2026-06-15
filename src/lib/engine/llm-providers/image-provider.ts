import OpenAI from "openai";
import { getDoubaoBaseUrl, getLlmConfig } from "@/lib/engine/llm-config";

export async function generateImageBuffer(
  prompt: string
): Promise<Buffer> {
  const { image } = getLlmConfig();

  switch (image.provider) {
    case "openai":
      return generateOpenAiImage(prompt, image.model);
    case "google":
      return generateGoogleImage(prompt, image.model);
    case "doubao":
      return generateDoubaoImage(prompt, image.model);
    default:
      throw new Error(`Unsupported image LLM provider: ${image.provider}`);
  }
}

async function generateOpenAiImage(
  prompt: string,
  model: string
): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const client = new OpenAI({ apiKey });
  const response = await client.images.generate({
    model,
    prompt,
    n: 1,
    size: "1024x1024",
    response_format: "b64_json",
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI image LLM returned no image data");
  return Buffer.from(b64, "base64");
}

async function generateGoogleImage(
  prompt: string,
  model: string
): Promise<Buffer> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not configured");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1 },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google image API error: ${errorText}`);
  }

  const data = (await response.json()) as {
    predictions?: { bytesBase64Encoded?: string }[];
  };

  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error("Google image LLM returned no image data");
  return Buffer.from(b64, "base64");
}

async function generateDoubaoImage(
  prompt: string,
  model: string
): Promise<Buffer> {
  const apiKey = process.env.DOUBAO_API_KEY;
  if (!apiKey) throw new Error("DOUBAO_API_KEY is not configured");

  // Seedream 4.x/5.x requires >= 3,686,400 pixels (e.g. 2560x1440).
  // 2048x2048 works across Seedream 3.x–5.x models.
  const size = process.env.DOUBAO_IMAGE_SIZE || "2048x2048";

  const response = await fetch(`${getDoubaoBaseUrl()}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
      n: 1,
      response_format: "b64_json",
      watermark: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Doubao image API error: ${errorText}`);
  }

  const data = (await response.json()) as {
    data?: { b64_json?: string }[];
  };

  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("Doubao image LLM returned no image data");
  return Buffer.from(b64, "base64");
}
