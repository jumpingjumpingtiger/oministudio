export function condensePromptToProjectName(
  prompt: string,
  maxLength = 40
): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  if (!cleaned) return "Untitled Project";

  if (cleaned.length <= maxLength) return cleaned;

  const truncated = cleaned.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 10) {
    return truncated.slice(0, lastSpace);
  }
  return truncated;
}
