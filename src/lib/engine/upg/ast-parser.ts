import { parse } from "acorn";
import type { AstNode } from "./types";

export interface ParsedFile {
  filePath: string;
  content: string;
  ast: AstNode | null;
  /** Offset of the first char of each line, for offset→line mapping. */
  lineStarts: number[];
  error?: string;
}

function computeLineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** 1-based line number for a byte offset. */
export function offsetToLine(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Parse JS/ESM source. Returns ast=null on syntax error (error captured). */
export function parseJsFile(filePath: string, content: string): ParsedFile {
  const lineStarts = computeLineStarts(content);
  try {
    const ast = parse(content, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: false,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowImportExportEverywhere: true,
    }) as unknown as AstNode;
    return { filePath, content, ast, lineStarts };
  } catch (moduleErr) {
    // Retry as script (some generated files are not strict modules).
    try {
      const ast = parse(content, {
        ecmaVersion: "latest",
        sourceType: "script",
        locations: false,
        allowReturnOutsideFunction: true,
      }) as unknown as AstNode;
      return { filePath, content, ast, lineStarts };
    } catch {
      return {
        filePath,
        content,
        ast: null,
        lineStarts,
        error: moduleErr instanceof Error ? moduleErr.message : "parse error",
      };
    }
  }
}

export function isJsFile(path: string): boolean {
  return /\.(m?js|jsx|ts|tsx)$/i.test(path);
}

export function sliceSource(content: string, node: AstNode): string {
  return content.slice(node.start, node.end);
}

/**
 * Flatten a MemberExpression/CallExpression callee into a dotted path.
 * e.g. this.physics.add.sprite -> "this.physics.add.sprite"
 */
export function memberPath(node: AstNode | undefined | null): string {
  if (!node) return "";
  switch (node.type) {
    case "ThisExpression":
      return "this";
    case "Identifier":
      return (node.name as string) || "";
    case "MemberExpression": {
      const obj = memberPath(node.object as AstNode);
      const prop = node.computed
        ? "[]"
        : ((node.property as AstNode)?.name as string) || "";
      return obj ? `${obj}.${prop}` : prop;
    }
    case "CallExpression":
      return memberPath(node.callee as AstNode);
    default:
      return "";
  }
}

/** Collect all string literals inside a node subtree. */
export function collectStringLiterals(node: AstNode): string[] {
  const out: string[] = [];
  const visit = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const an = n as AstNode;
    if (an.type === "Literal" && typeof an.value === "string") {
      out.push(an.value);
    }
    for (const key of Object.keys(an)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const child = (an as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(node);
  return out;
}

/** Collect `this.<prop>` member accesses inside a node subtree. */
export function collectThisProps(node: AstNode): Set<string> {
  const out = new Set<string>();
  const visit = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const an = n as AstNode;
    if (
      an.type === "MemberExpression" &&
      (an.object as AstNode)?.type === "ThisExpression" &&
      !an.computed
    ) {
      const prop = ((an.property as AstNode)?.name as string) || "";
      if (prop) out.add(prop);
    }
    for (const key of Object.keys(an)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const child = (an as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(node);
  return out;
}

const TOKEN_STOPWORDS = new Set([
  "this",
  "const",
  "let",
  "var",
  "function",
  "return",
  "new",
  "true",
  "false",
  "null",
  "undefined",
]);

/** Tokenize code/text for lexical + semantic scoring. */
export function tokenizeCode(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/asset:\/\/\w+\/[\w-]+/g, (m) => " " + m.replace("asset://", " "))
    .replace(/([a-z])([A-Z])/g, "$1 $2") // split camelCase
    .replace(/[^\w\u4e00-\u9fff]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !TOKEN_STOPWORDS.has(t));
}
