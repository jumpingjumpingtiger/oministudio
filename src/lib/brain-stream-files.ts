export interface StreamFileUpdate {
  path: string;
  content: string;
  isNew: boolean;
}

function unescapeJsonString(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = value[++i];
    if (next === undefined) break;
    switch (next) {
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      case "u": {
        const hex = value.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          out += next;
        }
        break;
      }
      default:
        out += next;
    }
  }
  return out;
}

function unescapeJsonStringPartial(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    if (i + 1 >= value.length) break;
    const next = value[i + 1];
    if (next === "n") {
      out += "\n";
      i++;
    } else if (next === "r") {
      out += "\r";
      i++;
    } else if (next === "t") {
      out += "\t";
      i++;
    } else if (next === '"') {
      out += '"';
      i++;
    } else if (next === "\\") {
      out += "\\";
      i++;
    } else {
      out += next;
      i++;
    }
  }
  return out;
}

/** Incrementally extract file path/content pairs from a streaming Brain JSON payload. */
export function createBrainStreamFileExtractor() {
  let buffer = "";
  const knownPaths = new Set<string>();
  const lastContentByPath = new Map<string, string>();

  return {
    push(chunk: string): StreamFileUpdate[] {
      if (!chunk) return [];
      buffer += chunk;

      const updates: StreamFileUpdate[] = [];
      const completeRe =
        /"path"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

      let match: RegExpExecArray | null;
      while ((match = completeRe.exec(buffer)) !== null) {
        const path = unescapeJsonString(match[1]);
        const content = unescapeJsonString(match[2]);
        const prev = lastContentByPath.get(path);
        if (prev === content) continue;

        const isNew = !knownPaths.has(path);
        knownPaths.add(path);
        lastContentByPath.set(path, content);
        updates.push({ path, content, isNew });
      }

      const partialRe =
        /"path"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)$/;
      const partial = buffer.match(partialRe);
      if (partial) {
        const path = unescapeJsonString(partial[1]);
        const content = unescapeJsonStringPartial(partial[2]);
        const prev = lastContentByPath.get(path);
        if (prev !== content) {
          const isNew = !knownPaths.has(path);
          knownPaths.add(path);
          lastContentByPath.set(path, content);
          updates.push({ path, content, isNew });
        }
      }

      return updates;
    },
    reset() {
      buffer = "";
      knownPaths.clear();
      lastContentByPath.clear();
    },
  };
}
