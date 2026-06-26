/** Detect when Brain JSON output reaches file/code payload (end of "thinking" phase). */
const CODE_OUTPUT_MARKERS = [
  /"files"\s*:\s*\[/,
  /"content"\s*:\s*"/,
];

export function shouldStartBrainCodeOutput(accumulated: string): boolean {
  return CODE_OUTPUT_MARKERS.some((re) => re.test(accumulated));
}

export type LlmStreamPhase = "enhance" | "brain";

export interface BrainStreamSplitter {
  push: (chunk: string) => {
    thinkingChunks: string[];
    codeChunks: string[];
    codeStarted: boolean;
  };
  reset: () => void;
}

/** Route Brain LLM stream chunks into thinking vs code phases. */
export function createBrainStreamSplitter(): BrainStreamSplitter {
  let accumulated = "";
  let codeStarted = false;

  return {
    reset() {
      accumulated = "";
      codeStarted = false;
    },
    push(chunk: string) {
      const thinkingChunks: string[] = [];
      const codeChunks: string[] = [];

      if (!chunk) {
        return { thinkingChunks, codeChunks, codeStarted };
      }

      if (codeStarted) {
        codeChunks.push(chunk);
        return { thinkingChunks, codeChunks, codeStarted };
      }

      accumulated += chunk;
      if (shouldStartBrainCodeOutput(accumulated)) {
        codeStarted = true;
        codeChunks.push(chunk);
      } else {
        thinkingChunks.push(chunk);
      }

      return { thinkingChunks, codeChunks, codeStarted: codeStarted && codeChunks.length > 0 };
    },
  };
}
