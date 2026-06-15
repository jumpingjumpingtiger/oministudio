export type BrainLlmProvider = "openai" | "claude" | "google" | "doubao";
export type ImageLlmProvider = "openai" | "google" | "doubao";

export interface LlmConfig {
  brain: {
    provider: BrainLlmProvider;
    model: string;
  };
  image: {
    provider: ImageLlmProvider;
    model: string;
  };
}

const DEFAULT_BRAIN_MODELS: Record<BrainLlmProvider, string> = {
  openai: "gpt-4o-mini",
  claude: "claude-sonnet-4-20250514",
  google: "gemini-2.0-flash",
  doubao: "doubao-pro-32k",
};

const DEFAULT_IMAGE_MODELS: Record<ImageLlmProvider, string> = {
  openai: "dall-e-3",
  google: "imagen-3.0-generate-002",
  doubao: "doubao-seedream-3-0-t2i",
};

function parseProvider<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  if (value && allowed.includes(value as T)) {
    return value as T;
  }
  return fallback;
}

export function getLlmConfig(): LlmConfig {
  const brainProvider = parseProvider(
    process.env.BRAIN_LLM_PROVIDER,
    ["openai", "claude", "google", "doubao"] as const,
    "openai"
  );

  const imageProvider = parseProvider(
    process.env.IMAGE_LLM_PROVIDER,
    ["openai", "google", "doubao"] as const,
    "openai"
  );

  return {
    brain: {
      provider: brainProvider,
      model:
        process.env.BRAIN_LLM_MODEL ||
        process.env.OPENAI_MODEL ||
        DEFAULT_BRAIN_MODELS[brainProvider],
    },
    image: {
      provider: imageProvider,
      model:
        process.env.IMAGE_LLM_MODEL ||
        process.env.IMAGE_MODEL ||
        DEFAULT_IMAGE_MODELS[imageProvider],
    },
  };
}

export function isBrainLlmConfigured(): boolean {
  const { brain } = getLlmConfig();
  switch (brain.provider) {
    case "openai":
      return !!process.env.OPENAI_API_KEY;
    case "claude":
      return !!process.env.ANTHROPIC_API_KEY;
    case "google":
      return !!process.env.GOOGLE_API_KEY;
    case "doubao":
      return !!process.env.DOUBAO_API_KEY;
    default:
      return false;
  }
}

export function isImageLlmConfigured(): boolean {
  const { image } = getLlmConfig();
  switch (image.provider) {
    case "openai":
      return !!process.env.OPENAI_API_KEY;
    case "google":
      return !!process.env.GOOGLE_API_KEY;
    case "doubao":
      return !!process.env.DOUBAO_API_KEY;
    default:
      return false;
  }
}

export function getDoubaoBaseUrl(): string {
  return (
    process.env.DOUBAO_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3"
  );
}
