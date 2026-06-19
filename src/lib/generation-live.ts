import type {
  FileChangeType,
  GenerationLiveState,
  GenerationProgressEvent,
} from "@/lib/generation-progress";

export const EMPTY_LIVE_STATE: GenerationLiveState = {
  plannedFiles: [],
  visibleFiles: [],
  fileChangeTypes: {},
  fileContents: {},
  filePreviousContents: {},
  completedFiles: [],
  writingFilePath: null,
  plannedAssets: [],
  generatingAssetUri: null,
  completedAssetUris: [],
  lastFileWritten: null,
};

function addVisibleFile(files: string[], path: string): string[] {
  return files.includes(path) ? files : [...files, path];
}

export function applyProgressToLiveState(
  state: GenerationLiveState,
  event: GenerationProgressEvent
): GenerationLiveState {
  switch (event.type) {
    case "files_planned":
      return {
        ...state,
        plannedFiles: event.files,
        visibleFiles: [],
        fileChangeTypes: {},
        fileContents: {},
        filePreviousContents: {},
        completedFiles: [],
        writingFilePath: null,
        lastFileWritten: null,
      };
    case "file_planned":
      return {
        ...state,
        visibleFiles: addVisibleFile(state.visibleFiles, event.path),
        fileChangeTypes: { ...state.fileChangeTypes, [event.path]: event.changeType },
        fileContents: {
          ...state.fileContents,
          [event.path]: state.fileContents[event.path] ?? "",
        },
      };
    case "file_writing":
      return {
        ...state,
        writingFilePath: event.path,
        visibleFiles: addVisibleFile(state.visibleFiles, event.path),
        fileContents: {
          ...state.fileContents,
          [event.path]: state.fileContents[event.path] ?? "",
        },
      };
    case "file_content_progress":
      return {
        ...state,
        writingFilePath: event.path,
        visibleFiles: addVisibleFile(state.visibleFiles, event.path),
        fileContents: { ...state.fileContents, [event.path]: event.content },
      };
    case "file_written": {
      const nextPrevious =
        event.previousContent !== undefined
          ? { ...state.filePreviousContents, [event.path]: event.previousContent }
          : state.filePreviousContents;
      return {
        ...state,
        writingFilePath: null,
        visibleFiles: addVisibleFile(state.visibleFiles, event.path),
        fileChangeTypes: { ...state.fileChangeTypes, [event.path]: event.changeType },
        fileContents: { ...state.fileContents, [event.path]: event.content },
        filePreviousContents: nextPrevious,
        completedFiles: state.completedFiles.includes(event.path)
          ? state.completedFiles
          : [...state.completedFiles, event.path],
        lastFileWritten: event.path,
      };
    }
    case "assets_planned":
      return {
        ...state,
        plannedAssets: event.assets,
        completedAssetUris: [],
        generatingAssetUri: null,
      };
    case "asset_generating":
      return { ...state, generatingAssetUri: event.uri };
    case "asset_generated":
    case "asset_reused":
      return {
        ...state,
        generatingAssetUri: null,
        completedAssetUris: state.completedAssetUris.includes(event.uri)
          ? state.completedAssetUris
          : [...state.completedAssetUris, event.uri],
      };
    case "asset_failed":
      return { ...state, generatingAssetUri: null };
    case "code_complete":
    case "complete":
      return { ...state, writingFilePath: null, generatingAssetUri: null };
    default:
      return state;
  }
}

export function getFileChangeType(
  path: string,
  live?: GenerationLiveState
): FileChangeType | null {
  return live?.fileChangeTypes[path] ?? null;
}
