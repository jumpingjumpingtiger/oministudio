/** Ephemeral Brain LLM session info shown in chat during generation (not persisted). */
export interface EnhancedPromptDisplay {
  original: string;
  enhanced: string;
  summary: string;
}

export interface BrainSessionDisplay {
  inputTokens: number | null;
  outputTokens: number | null;
  contextLines: string[];
  /** Scrollable LLM "thinking" stream (enhance + brain pre-code). */
  thinkingText: string;
  thinkingPhase: "enhance" | "brain" | null;
  /** Scrollable Brain LLM code/JSON output after thinking clears. */
  streamText: string;
  enhancedPrompt: EnhancedPromptDisplay | null;
  status: "preparing" | "enhancing" | "calling" | "streaming" | "done";
}

export const EMPTY_BRAIN_SESSION: BrainSessionDisplay = {
  inputTokens: null,
  outputTokens: null,
  contextLines: [],
  thinkingText: "",
  thinkingPhase: null,
  streamText: "",
  enhancedPrompt: null,
  status: "preparing",
};

function oneLineSummary(text: string, max = 80): string {
  const line = text.trim().replace(/\s+/g, " ");
  if (line.length <= max) return line;
  return `${line.slice(0, max)}…`;
}

export function applyBrainProgressEvent(
  state: BrainSessionDisplay,
  event: {
    type: string;
    inputTokens?: number;
    outputTokens?: number;
    line?: string;
    chunk?: string;
    phase?: "enhance" | "brain";
    original?: string;
    enhanced?: string;
  }
): BrainSessionDisplay {
  switch (event.type) {
    case "brain_context_start":
      return {
        ...state,
        inputTokens: event.inputTokens ?? state.inputTokens,
        status: "preparing",
        contextLines: [],
        streamText: "",
        thinkingText: "",
        thinkingPhase: null,
      };
    case "brain_context_line":
      if (!event.line) return state;
      return {
        ...state,
        contextLines: [...state.contextLines, event.line],
      };
    case "prompt_enhance_start":
      return {
        ...state,
        status: "enhancing",
        thinkingText: "",
        thinkingPhase: "enhance",
        streamText: "",
      };
    case "llm_thinking_chunk":
      if (!event.chunk) return state;
      return {
        ...state,
        status: event.phase === "enhance" ? "enhancing" : "calling",
        thinkingPhase: event.phase ?? state.thinkingPhase,
        thinkingText: state.thinkingText + event.chunk,
      };
    case "prompt_enhanced": {
      const enhanced = event.enhanced?.trim() ?? "";
      const original = event.original?.trim() ?? "";
      return {
        ...state,
        thinkingText: "",
        thinkingPhase: null,
        enhancedPrompt: {
          original,
          enhanced,
          summary: oneLineSummary(enhanced || original),
        },
      };
    }
    case "brain_calling":
      return {
        ...state,
        status: "calling",
        thinkingText: "",
        thinkingPhase: "brain",
        streamText: "",
      };
    case "llm_code_output_start":
      return {
        ...state,
        thinkingText: "",
        thinkingPhase: null,
        status: "streaming",
      };
    case "brain_stream_chunk":
      if (!event.chunk) return state;
      return {
        ...state,
        status: "streaming",
        streamText: state.streamText + event.chunk,
      };
    case "brain_token_usage":
      return {
        ...state,
        inputTokens: event.inputTokens ?? state.inputTokens,
        outputTokens: event.outputTokens ?? state.outputTokens,
        status: "done",
        thinkingText: "",
        thinkingPhase: null,
      };
    default:
      return state;
  }
}
