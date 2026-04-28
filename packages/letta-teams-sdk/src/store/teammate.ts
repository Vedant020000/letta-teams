/**
 * Teammate storage - CRUD operations for teammate state files
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ConversationTargetState,
  TeammateState,
  TeammateStatus,
} from "../types.js";
import { formatTargetName, getTargetKind, parseTargetName } from "../targets.js";

const LTEAMS_DIR = ".lteams";

/**
 * Override project directory (used by daemon to find teammate files)
 * When set, .lteams directory is relative to this instead of process.cwd()
 */
let projectDirOverride: string | null = null;

/**
 * Set the project directory override (used by daemon)
 */
export function setProjectDir(dir: string): void {
  projectDirOverride = dir;
}

/**
 * Get the current project directory
 */
export function getProjectDir(): string {
  return projectDirOverride || process.cwd();
}

/**
 * Get the .lteams directory path
 * Uses projectDirOverride if set, otherwise falls back to cwd
 */
export function getLteamsDir(): string {
  return path.join(getProjectDir(), LTEAMS_DIR);
}

/**
 * Ensure .lteams directory exists
 */
export function ensureLteamsDir(): void {
  const dir = getLteamsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get the path to a teammate's JSON file
 */
export function getTeammatePath(name: string): string {
  return path.join(getLteamsDir(), `${name}.json`);
}

/**
 * Check if a teammate exists
 */
export function teammateExists(name: string): boolean {
  return fs.existsSync(getTeammatePath(name));
}

function migrateTeammateState(name: string, state: TeammateState): TeammateState {
  // Ensure name matches filename
  if (state.name !== name) {
    return { ...state, name };
  }
  return state;
}

/**
 * Load a teammate's state
 * Returns null if the file doesn't exist or is corrupted
 * Ensures the name field matches the filename (defensive against corrupted JSON)
 */
export function loadTeammate(name: string): TeammateState | null {
  const filePath = getTeammatePath(name);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const state = JSON.parse(content) as TeammateState;
    return migrateTeammateState(name, state);
  } catch {
    // Return null if JSON is corrupted
    return null;
  }
}

/**
 * Save a teammate's state
 */
export function saveTeammate(state: TeammateState): void {
  ensureLteamsDir();
  const filePath = getTeammatePath(state.name);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export function getRootConversationId(state: TeammateState): string | undefined {
  return state.targets?.find((t) => t.kind === 'root')?.conversationId;
}

export function getConversationTarget(rootName: string, targetName: string): ConversationTargetState | null {
  const teammate = loadTeammate(rootName);
  if (!teammate) return null;

  const parsed = parseTargetName(targetName);
  if (parsed.rootName !== rootName) {
    return null;
  }

  return teammate.targets?.find((target) => target.name === parsed.fullName) || null;
}

export function listConversationTargets(rootName: string): ConversationTargetState[] {
  return loadTeammate(rootName)?.targets || [];
}

/**
 * Get the memory target for a teammate (if any)
 */
export function getMemoryTarget(rootName: string): ConversationTargetState | undefined {
  const teammate = loadTeammate(rootName);
  return teammate?.targets?.find((t) => t.kind === 'memory');
}

/**
 * Get the memory conversation ID for a teammate
 */
export function getMemoryConversationId(rootName: string): string | undefined {
  return getMemoryTarget(rootName)?.conversationId;
}

export function targetExists(targetName: string): boolean {
  const parsed = parseTargetName(targetName);
  if (parsed.isRoot) {
    return teammateExists(parsed.rootName);
  }
  return getConversationTarget(parsed.rootName, parsed.fullName) !== null;
}

export function createConversationTarget(
  rootName: string,
  target: Omit<ConversationTargetState, 'rootName' | 'kind' | 'name'> & { forkName: string; kind?: ConversationTargetState['kind'] }
): ConversationTargetState | null {
  const state = loadTeammate(rootName);
  if (!state) return null;

  const name = formatTargetName(rootName, target.forkName);
  if (state.targets?.some((existing) => existing.name === name)) {
    throw new Error(`Target '${name}' already exists`);
  }

  const created: ConversationTargetState = {
    name,
    rootName,
    forkName: target.forkName,
    kind: target.kind ?? getTargetKind(target.forkName),
    conversationId: target.conversationId,
    parentTargetName: target.parentTargetName,
    parentConversationId: target.parentConversationId,
    createdAt: target.createdAt,
    lastActiveAt: target.lastActiveAt,
    status: target.status,
  };

  const updated = {
    ...state,
    targets: [...(state.targets || []), created],
  };
  saveTeammate(updated);
  return created;
}

export function updateConversationTarget(
  rootName: string,
  targetName: string,
  updates: Partial<Pick<ConversationTargetState, 'conversationId' | 'lastActiveAt' | 'status' | 'parentTargetName' | 'parentConversationId'>>,
): ConversationTargetState | null {
  const state = loadTeammate(rootName);
  if (!state || !state.targets) return null;

  const index = state.targets.findIndex((target) => target.name === targetName);
  if (index === -1) return null;

  const nextTargets = [...state.targets];
  nextTargets[index] = {
    ...nextTargets[index],
    ...updates,
  };

  saveTeammate({
    ...state,
    targets: nextTargets,
  });

  return nextTargets[index];
}

/**
 * Update specific fields of a teammate
 */
export function updateTeammate(
  name: string,
  updates: Partial<
    Pick<TeammateState,
      | "status"
      | "role"
      | "model"
      | "contextWindowLimit"
      | "lastUpdated"
      | "todoItems"
      | "statusSummary"
      | "statusEvents"
      | "errorDetails"
      | "spawnPrompt"
      | "targets"
      | "memfsEnabled"
      | "memfsStartup"
      | "memfsMemoryDir"
      | "memfsSyncStatus"
      | "memfsLastSyncedAt"
      | "memfsSyncError"
      | "initStatus"
      | "initTaskId"
      | "initConversationId"
      | "initError"
      | "selectedSpecId"
      | "selectedSpecTitle"
      | "initStartedAt"
      | "initCompletedAt"
    >
  >
): TeammateState | null {
  const state = loadTeammate(name);
  if (!state) return null;

  const updated = {
    ...state,
    ...updates,
    lastUpdated: new Date().toISOString(),
  };
  saveTeammate(updated);
  return updated;
}

/**
 * Remove a teammate's JSON file
 */
export function removeTeammate(name: string): boolean {
  const filePath = getTeammatePath(name);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * List all teammates
 * Logs warnings for corrupted JSON files
 */
export function listTeammates(): TeammateState[] {
  const dir = getLteamsDir();
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files
    .map((file) => {
      const name = file.replace(".json", "");
      const state = loadTeammate(name);
      if (state === null) {
        console.warn(`Warning: Could not load teammate '${name}' - file may be corrupted. Path: ${getTeammatePath(name)}`);
      }
      return state;
    })
    .filter((t): t is TeammateState => t !== null);
}
