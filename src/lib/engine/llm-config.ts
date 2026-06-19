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

const BRAIN_API_KEY_ENV: Record<BrainLlmProvider, string> = {
  openai: "BRAIN_OPENAI_API_KEY",
  claude: "BRAIN_ANTHROPIC_API_KEY",
  google: "BRAIN_GOOGLE_API_KEY",
  doubao: "BRAIN_DOUBAO_API_KEY",
};

const IMAGE_API_KEY_ENV: Record<ImageLlmProvider, string> = {
  openai: "IMAGE_OPENAI_API_KEY",
  google: "IMAGE_GOOGLE_API_KEY",
  doubao: "IMAGE_DOUBAO_API_KEY",
};

const LEGACY_BRAIN_API_KEY_ENV: Record<BrainLlmProvider, string> = {
  openai: "OPENAI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  doubao: "DOUBAO_API_KEY",
};

const LEGACY_IMAGE_API_KEY_ENV: Record<ImageLlmProvider, string> = {
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  doubao: "DOUBAO_API_KEY",
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

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

export function getBrainApiKeyEnvVar(provider?: BrainLlmProvider): string {
  const resolved = provider ?? getLlmConfig().brain.provider;
  return BRAIN_API_KEY_ENV[resolved];
}

export function getImageApiKeyEnvVar(provider?: ImageLlmProvider): string {
  const resolved = provider ?? getLlmConfig().image.provider;
  return IMAGE_API_KEY_ENV[resolved];
}

export function getBrainApiKey(provider?: BrainLlmProvider): string | undefined {
  const resolved = provider ?? getLlmConfig().brain.provider;
  switch (resolved) {
    case "openai":
      return firstNonEmpty(
        process.env.BRAIN_OPENAI_API_KEY,
        process.env.OPENAI_API_KEY
      );
    case "claude":
      return firstNonEmpty(
        process.env.BRAIN_ANTHROPIC_API_KEY,
        process.env.ANTHROPIC_API_KEY
      );
    case "google":
      return firstNonEmpty(
        process.env.BRAIN_GOOGLE_API_KEY,
        process.env.GOOGLE_API_KEY
      );
    case "doubao":
      return firstNonEmpty(
        process.env.BRAIN_DOUBAO_API_KEY,
        process.env.DOUBAO_API_KEY
      );
    default:
      return undefined;
  }
}

export function getImageApiKey(provider?: ImageLlmProvider): string | undefined {
  const resolved = provider ?? getLlmConfig().image.provider;
  switch (resolved) {
    case "openai":
      return firstNonEmpty(
        process.env.IMAGE_OPENAI_API_KEY,
        process.env.OPENAI_API_KEY
      );
    case "google":
      return firstNonEmpty(
        process.env.IMAGE_GOOGLE_API_KEY,
        process.env.GOOGLE_API_KEY
      );
    case "doubao":
      return firstNonEmpty(
        process.env.IMAGE_DOUBAO_API_KEY,
        process.env.DOUBAO_API_KEY
      );
    default:
      return undefined;
  }
}

export function requireBrainApiKey(provider?: BrainLlmProvider): string {
  const resolved = provider ?? getLlmConfig().brain.provider;
  const key = getBrainApiKey(resolved);
  if (!key) {
    const preferred = BRAIN_API_KEY_ENV[resolved];
    const legacy = LEGACY_BRAIN_API_KEY_ENV[resolved];
    throw new Error(
      `${preferred} is not configured` +
        (legacy !== preferred ? ` (legacy fallback: ${legacy})` : "")
    );
  }
  return key;
}

export function requireImageApiKey(provider?: ImageLlmProvider): string {
  const resolved = provider ?? getLlmConfig().image.provider;
  const key = getImageApiKey(resolved);
  if (!key) {
    const preferred = IMAGE_API_KEY_ENV[resolved];
    const legacy = LEGACY_IMAGE_API_KEY_ENV[resolved];
    throw new Error(
      `${preferred} is not configured` +
        (legacy !== preferred ? ` (legacy fallback: ${legacy})` : "")
    );
  }
  return key;
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
  return !!getBrainApiKey();
}

export function isImageLlmConfigured(): boolean {
  return !!getImageApiKey();
}

export function getBrainDoubaoBaseUrl(): string {
  return (
    process.env.BRAIN_DOUBAO_BASE_URL ||
    process.env.DOUBAO_BASE_URL ||
    "https://ark.cn-beijing.volces.com/api/v3"
  );
}

export function getImageDoubaoBaseUrl(): string {
  return (
    process.env.IMAGE_DOUBAO_BASE_URL ||
    process.env.DOUBAO_BASE_URL ||
    "https://ark.cn-beijing.volces.com/api/v3"
  );
}

/** @deprecated Use getBrainDoubaoBaseUrl or getImageDoubaoBaseUrl */
export function getDoubaoBaseUrl(): string {
  return getBrainDoubaoBaseUrl();
}
