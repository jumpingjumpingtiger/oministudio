/** Rough token estimate (no tiktoken dependency). Good enough for UI preflight. */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk / 1.5 + other / 4);
}

export function estimateTokensForMessages(
  parts: { role: string; content: string }[]
): number {
  return parts.reduce((sum, p) => sum + estimateTokenCount(p.content) + 4, 0);
}
