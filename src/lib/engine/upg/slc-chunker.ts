import type { AstNode, LifecyclePhase, SlcChunk } from "./types";
import {
  collectStringLiterals,
  memberPath,
  offsetToLine,
  sliceSource,
  tokenizeCode,
  type ParsedFile,
} from "./ast-parser";

export interface SceneInfo {
  name: string;
  filePath: string;
  lifecycles: LifecyclePhase[];
}

export interface FileAnalysis {
  chunks: SlcChunk[];
  scenes: SceneInfo[];
  /** Module-level config facts found in this file. */
  config?: {
    width?: number;
    height?: number;
    physics?: string;
    gravityY?: number;
    sceneList: string[];
  };
}

const ENTITY_FACTORY =
  /\.(add|make)\.(sprite|image|text|group|tilesprite|tilemap|graphics|container|rectangle|circle|ellipse|zone|bitmaptext|existing|particles|emitter|video|mesh|rope|star|polygon|line|grid|nineslice|dom|staticgroup|staticimage|staticsprite)\b/i;
const PHYSICS_FACTORY = /physics\.add\.(sprite|image|group|staticgroup|existing|staticimage|body)/i;
const EVENT_REGISTER =
  /(physics\.add\.(collider|overlap))|(input\.(keyboard\.)?on)|(input\.keyboard\.(addkey|createcursorkeys))|(time\.(addevent|delayedcall|additerative))|(events\.on)|(input\.on)|(anims\.create)|(\.setinteractive)/i;
const CLEANUP_CALL =
  /\.(off|removealllisteners|removeallevents|remove|destroy|stop|clear|shutdown|killall)\b/i;

function lifecycleOf(methodName: string): LifecyclePhase {
  switch (methodName) {
    case "preload":
      return "preload";
    case "create":
    case "init":
      return "create";
    case "update":
      return "update";
    case "shutdown":
    case "destroy":
      return "shutdown";
    default:
      return "method";
  }
}

let chunkSeq = 0;
function nextChunkId(prefix: string): string {
  chunkSeq += 1;
  return `${prefix}#${chunkSeq}`;
}

function makeChunk(
  parsed: ParsedFile,
  params: {
    sceneName: string | null;
    lifecycle: LifecyclePhase;
    entityId: string | null;
    kind: SlcChunk["kind"];
    nodes: AstNode[];
  }
): SlcChunk | null {
  const { nodes } = params;
  if (!nodes.length) return null;
  const start = Math.min(...nodes.map((n) => n.start));
  const end = Math.max(...nodes.map((n) => n.end));
  const code = nodes.map((n) => sliceSource(parsed.content, n)).join("\n");
  const assetKeys = new Set<string>();
  for (const n of nodes) {
    for (const s of collectStringLiterals(n)) {
      if (/^asset:\/\//.test(s)) {
        const key = s.split("/").pop();
        if (key) assetKeys.add(key);
      } else if (/^[a-zA-Z0-9_-]{2,40}$/.test(s)) {
        assetKeys.add(s);
      }
    }
  }
  return {
    id: nextChunkId(params.kind),
    filePath: parsed.filePath,
    sceneName: params.sceneName,
    lifecycle: params.lifecycle,
    entityId: params.entityId,
    assetKeys: [...assetKeys],
    start,
    end,
    startLine: offsetToLine(parsed.lineStarts, start),
    endLine: offsetToLine(parsed.lineStarts, end),
    code,
    kind: params.kind,
    tokens: tokenizeCode(`${params.entityId || ""} ${code}`),
  };
}

/** Resolve the entity name a statement primarily targets, plus whether it is a factory seed. */
function classifyStatement(stmt: AstNode): {
  entityId: string | null;
  isSeed: boolean;
  isEvent: boolean;
} {
  let entityId: string | null = null;
  let isSeed = false;
  let isEvent = false;

  const expr =
    stmt.type === "ExpressionStatement"
      ? (stmt.expression as AstNode)
      : stmt.type === "VariableDeclaration"
        ? null
        : null;

  // const x = factory(...)
  if (stmt.type === "VariableDeclaration") {
    const decl = (stmt.declarations as AstNode[])?.[0];
    if (decl?.init) {
      const path = memberPath(decl.init as AstNode);
      entityId = ((decl.id as AstNode)?.name as string) || null;
      if (ENTITY_FACTORY.test(path) || PHYSICS_FACTORY.test(path)) isSeed = true;
      if (EVENT_REGISTER.test(path)) isEvent = true;
    }
  } else if (expr?.type === "AssignmentExpression") {
    const left = expr.left as AstNode;
    const leftPath = memberPath(left);
    // this.player = ...   -> entity "player"
    const m = leftPath.match(/^this\.([\w$]+)$/);
    if (m) entityId = m[1];
    else if (left.type === "Identifier") entityId = left.name as string;
    const rightPath = memberPath(expr.right as AstNode);
    if (ENTITY_FACTORY.test(rightPath) || PHYSICS_FACTORY.test(rightPath)) isSeed = true;
    if (EVENT_REGISTER.test(rightPath)) isEvent = true;
  } else if (expr?.type === "CallExpression") {
    const path = memberPath(expr);
    if (EVENT_REGISTER.test(path)) isEvent = true;
    // this.player.setBounce(...) -> entity "player"
    const m = path.match(/^this\.([\w$]+)\./);
    if (m) entityId = m[1];
  }

  return { entityId, isSeed, isEvent };
}

function analyzeCreate(
  parsed: ParsedFile,
  sceneName: string | null,
  body: AstNode[]
): SlcChunk[] {
  const chunks: SlcChunk[] = [];
  const entityNodes = new Map<string, AstNode[]>();
  const eventNodes: AstNode[] = [];
  const miscNodes: AstNode[] = [];
  const knownEntities = new Set<string>();

  for (const stmt of body) {
    const { entityId, isSeed, isEvent } = classifyStatement(stmt);

    if (isEvent) {
      eventNodes.push(stmt);
      continue;
    }
    if (entityId && (isSeed || knownEntities.has(entityId))) {
      if (isSeed) knownEntities.add(entityId);
      const arr = entityNodes.get(entityId) || [];
      arr.push(stmt);
      entityNodes.set(entityId, arr);
      continue;
    }
    miscNodes.push(stmt);
  }

  for (const [entityId, nodes] of entityNodes) {
    const c = makeChunk(parsed, {
      sceneName,
      lifecycle: "create",
      entityId,
      kind: "entity_init",
      nodes,
    });
    if (c) chunks.push(c);
  }
  if (eventNodes.length) {
    const c = makeChunk(parsed, {
      sceneName,
      lifecycle: "create",
      entityId: null,
      kind: "event_register",
      nodes: eventNodes,
    });
    if (c) chunks.push(c);
  }
  if (miscNodes.length) {
    const c = makeChunk(parsed, {
      sceneName,
      lifecycle: "create",
      entityId: null,
      kind: "misc",
      nodes: miscNodes,
    });
    if (c) chunks.push(c);
  }
  return chunks;
}

/** Which single entity (if any) an update sub-statement operates on. */
function branchEntity(node: AstNode): string | null {
  const props = new Set<string>();
  const visit = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const an = n as AstNode;
    if (
      an.type === "MemberExpression" &&
      (an.object as AstNode)?.type === "ThisExpression" &&
      !an.computed
    ) {
      const p = ((an.property as AstNode)?.name as string) || "";
      if (p) props.add(p);
    }
    for (const key of Object.keys(an)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const child = (an as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(node);
  // Heuristic: a control branch is entity-specific if it touches exactly one this.prop
  // that is not an input/system handle.
  const candidates = [...props].filter(
    (p) => !/^(input|cursors|keys|physics|time|cameras|scene|add|anims|sound|events)$/i.test(p)
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function analyzeUpdate(
  parsed: ParsedFile,
  sceneName: string | null,
  body: AstNode[]
): SlcChunk[] {
  const chunks: SlcChunk[] = [];
  const perEntity = new Map<string, AstNode[]>();
  const misc: AstNode[] = [];

  for (const stmt of body) {
    const ent = branchEntity(stmt);
    if (ent) {
      const arr = perEntity.get(ent) || [];
      arr.push(stmt);
      perEntity.set(ent, arr);
    } else {
      misc.push(stmt);
    }
  }

  for (const [entityId, nodes] of perEntity) {
    const c = makeChunk(parsed, {
      sceneName,
      lifecycle: "update",
      entityId,
      kind: "control_branch",
      nodes,
    });
    if (c) chunks.push(c);
  }
  if (misc.length) {
    const c = makeChunk(parsed, {
      sceneName,
      lifecycle: "update",
      entityId: null,
      kind: "control_branch",
      nodes: misc,
    });
    if (c) chunks.push(c);
  }
  return chunks;
}

function analyzeCleanup(
  parsed: ParsedFile,
  sceneName: string | null,
  body: AstNode[]
): SlcChunk[] {
  const cleanupNodes = body.filter((stmt) => {
    if (stmt.type !== "ExpressionStatement") return false;
    return CLEANUP_CALL.test(memberPath(stmt.expression as AstNode));
  });
  const c = makeChunk(parsed, {
    sceneName,
    lifecycle: "shutdown",
    entityId: null,
    kind: "cleanup",
    nodes: cleanupNodes.length ? cleanupNodes : body,
  });
  return c ? [c] : [];
}

function getMethodBody(method: AstNode): AstNode[] {
  const fn = method.value as AstNode | undefined;
  const block = fn?.body as AstNode | undefined;
  return (block?.body as AstNode[]) || [];
}

function sceneNameFromClass(cls: AstNode): string {
  const id = cls.id as AstNode | undefined;
  const name = (id?.name as string) || "";
  // Prefer super('Key') argument in constructor.
  const members = ((cls.body as AstNode)?.body as AstNode[]) || [];
  for (const m of members) {
    if (m.type === "MethodDefinition" && ((m.key as AstNode)?.name as string) === "constructor") {
      const stmts = getMethodBody(m);
      for (const s of stmts) {
        if (
          s.type === "ExpressionStatement" &&
          (s.expression as AstNode)?.type === "CallExpression" &&
          ((s.expression as AstNode).callee as AstNode)?.type === "Super"
        ) {
          const args = ((s.expression as AstNode).arguments as AstNode[]) || [];
          const first = args[0];
          if (first?.type === "Literal" && typeof first.value === "string") {
            return first.value;
          }
        }
      }
    }
  }
  return name || "Scene";
}

function extractConfig(parsed: ParsedFile): FileAnalysis["config"] | undefined {
  const ast = parsed.ast;
  if (!ast) return undefined;
  let found: FileAnalysis["config"] | undefined;

  const visit = (n: unknown) => {
    if (!n || typeof n !== "object" || found) return;
    const an = n as AstNode;
    // new Phaser.Game(config)
    if (an.type === "NewExpression" && /Phaser\.Game/i.test(memberPath(an.callee as AstNode))) {
      const arg = (an.arguments as AstNode[])?.[0];
      const obj = arg?.type === "ObjectExpression" ? arg : null;
      found = parseConfigObject(obj);
    }
    if (found) return;
    for (const key of Object.keys(an)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const child = (an as Record<string, unknown>)[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(ast);
  return found;
}

function parseConfigObject(obj: AstNode | null): FileAnalysis["config"] {
  const cfg: FileAnalysis["config"] = { sceneList: [] };
  if (!obj) return cfg;
  const props = (obj.properties as AstNode[]) || [];
  for (const p of props) {
    const keyName = ((p.key as AstNode)?.name as string) || ((p.key as AstNode)?.value as string);
    const val = p.value as AstNode;
    if (keyName === "width" && val?.type === "Literal") cfg.width = Number(val.value);
    if (keyName === "height" && val?.type === "Literal") cfg.height = Number(val.value);
    if (keyName === "scene") {
      if (val?.type === "ArrayExpression") {
        for (const el of (val.elements as AstNode[]) || []) {
          const nm = (el?.name as string) || memberPath(el);
          if (nm) cfg.sceneList.push(nm);
        }
      } else {
        const nm = (val?.name as string) || memberPath(val);
        if (nm) cfg.sceneList.push(nm);
      }
    }
    if (keyName === "physics" && val?.type === "ObjectExpression") {
      const pp = (val.properties as AstNode[]) || [];
      for (const q of pp) {
        const qn = ((q.key as AstNode)?.name as string) || "";
        if (qn === "default" && (q.value as AstNode)?.type === "Literal") {
          cfg.physics = String((q.value as AstNode).value);
        }
        const gv = findGravityY(q.value as AstNode);
        if (gv != null) cfg.gravityY = gv;
      }
    }
  }
  return cfg;
}

function findGravityY(node: AstNode | undefined): number | null {
  if (!node || node.type !== "ObjectExpression") return null;
  for (const p of (node.properties as AstNode[]) || []) {
    const kn = ((p.key as AstNode)?.name as string) || "";
    if (kn === "gravity") {
      const g = p.value as AstNode;
      if (g?.type === "ObjectExpression") {
        for (const q of (g.properties as AstNode[]) || []) {
          if (((q.key as AstNode)?.name as string) === "y" && (q.value as AstNode)?.type === "Literal") {
            return Number((q.value as AstNode).value);
          }
        }
      }
    }
    const nested = findGravityY(p.value as AstNode);
    if (nested != null) return nested;
  }
  return null;
}

/** Analyze one parsed file into SLC chunks + scene info + config facts. */
export function analyzeFile(parsed: ParsedFile): FileAnalysis {
  const result: FileAnalysis = { chunks: [], scenes: [] };
  if (!parsed.ast) return result;

  const classes: AstNode[] = [];
  const moduleLevel: AstNode[] = [];

  const topBody = (parsed.ast.body as AstNode[]) || [];
  const collectClass = (node: AstNode) => {
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      classes.push(node);
    }
  };
  for (const stmt of topBody) {
    if (stmt.type === "ClassDeclaration") collectClass(stmt);
    else if (
      stmt.type === "ExportNamedDeclaration" ||
      stmt.type === "ExportDefaultDeclaration"
    ) {
      const decl = stmt.declaration as AstNode | undefined;
      if (decl) collectClass(decl);
      else moduleLevel.push(stmt);
    } else {
      moduleLevel.push(stmt);
    }
  }

  // Module-level config chunk (main.js).
  const config = extractConfig(parsed);
  if (config && (config.sceneList.length || config.width || config.physics)) {
    result.config = config;
    if (moduleLevel.length) {
      const c = makeChunk(parsed, {
        sceneName: null,
        lifecycle: "config",
        entityId: null,
        kind: "config",
        nodes: moduleLevel,
      });
      if (c) result.chunks.push(c);
    }
  } else if (moduleLevel.length && !classes.length) {
    const c = makeChunk(parsed, {
      sceneName: null,
      lifecycle: "module",
      entityId: null,
      kind: "misc",
      nodes: moduleLevel,
    });
    if (c) result.chunks.push(c);
  }

  for (const cls of classes) {
    const sceneName = sceneNameFromClass(cls);
    const members = ((cls.body as AstNode)?.body as AstNode[]) || [];
    const lifecycles: LifecyclePhase[] = [];

    for (const m of members) {
      if (m.type !== "MethodDefinition") continue;
      const methodName = ((m.key as AstNode)?.name as string) || "";
      if (methodName === "constructor") continue;
      const body = getMethodBody(m);
      if (!body.length) continue;

      const phase = lifecycleOf(methodName);
      lifecycles.push(phase);

      if (phase === "preload") {
        for (const stmt of body) {
          const c = makeChunk(parsed, {
            sceneName,
            lifecycle: "preload",
            entityId: null,
            kind: "resource_load",
            nodes: [stmt],
          });
          if (c) result.chunks.push(c);
        }
      } else if (phase === "create") {
        result.chunks.push(...analyzeCreate(parsed, sceneName, body));
      } else if (phase === "update") {
        result.chunks.push(...analyzeUpdate(parsed, sceneName, body));
      } else if (phase === "shutdown") {
        result.chunks.push(...analyzeCleanup(parsed, sceneName, body));
      } else {
        const c = makeChunk(parsed, {
          sceneName,
          lifecycle: "method",
          entityId: null,
          kind: "misc",
          nodes: body,
        });
        if (c) result.chunks.push(c);
      }
    }

    result.scenes.push({ name: sceneName, filePath: parsed.filePath, lifecycles });
  }

  return result;
}

export function resetChunkSeq(): void {
  chunkSeq = 0;
}
