export interface ChatFileAttachment {
  name: string;
  type: string;
  size: number;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GeneratedAsset {
  order: number;
  name: string;
  type: "img" | "text" | "audio" | "video";
  uri: string;
  prompt: string;
  width?: number;
  height?: number;
  /** When false, reuse existing asset from project pool if prompt unchanged */
  regenerate?: boolean;
  /** Output image format: png (transparent sprites), jpeg/jpg (backgrounds) */
  format?: "png" | "jpeg" | "jpg";
}

export interface BrainLlmResult {
  files: GeneratedFile[];
  assets: GeneratedAsset[];
  summary: string;
}

export type RightPanelTab = "preview" | "code" | "assets";

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

export function buildFileTree(files: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];

  for (const filePath of files) {
    const parts = filePath.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const existingPath = parts.slice(0, i + 1).join("/");

      let node = current.find((n) => n.name === part);
      if (!node) {
        node = {
          name: part,
          path: existingPath,
          type: isFile ? "file" : "directory",
          children: isFile ? undefined : [],
        };
        current.push(node);
      }
      if (!isFile && node.children) {
        current = node.children;
      }
    }
  }

  const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
    return nodes
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({
        ...n,
        children: n.children ? sortNodes(n.children) : undefined,
      }));
  };

  return sortNodes(root);
}
