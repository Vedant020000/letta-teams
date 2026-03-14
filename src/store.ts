/**
 * Store module - manages .lteams/*.json files
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";
import type {
  ConversationTargetState,
  TeammateState,
  TeammateStatus,
  TaskState,
  TaskStatus,
} from "./types.js";
import { formatTargetName, getTargetKind, parseTargetName } from './targets.js';

const LTEAMS_DIR = ".lteams";
const AUTH_FILE = "authtoken.json";

// ═══════════════════════════════════════════════════════════════
// AUTH TOKEN STORAGE (in home directory for security)
// ═══════════════════════════════════════════════════════════════

/**
 * Auth token storage structure
 */
export interface AuthToken {
  apiKey: string;
  createdAt: string;
}

/**
 * Get the global auth directory path (in home directory)
 */
export function getGlobalAuthDir(): string {
  return path.join(os.homedir(), LTEAMS_DIR);
}

/**
 * Ensure the global auth directory exists
 */
export function ensureGlobalAuthDir(): void {
  const dir = getGlobalAuthDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get the path to the auth token file (in home directory)
 */
export function getAuthPath(): string {
  return path.join(getGlobalAuthDir(), AUTH_FILE);
}

/**
 * Check if an auth token exists
 */
export function hasAuthToken(): boolean {
  return fs.existsSync(getAuthPath());
}

/**
 * Load the auth token
 * Returns null if not found or corrupted
 */
export function loadAuthToken(): AuthToken | null {
  const filePath = getAuthPath();
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as AuthToken;
  } catch {
    return null;
  }
}

/**
 * Get the API key from env var or storage
 * Priority: LETTA_API_KEY env var > stored token
 * (Env vars override stored config - standard CLI convention)
 */
export function getApiKey(): string | null {
  // First check env var (takes priority)
  if (process.env.LETTA_API_KEY) {
    return process.env.LETTA_API_KEY;
  }
  // Fall back to stored token
  const token = loadAuthToken();
  return token?.apiKey || null;
}

/**
 * Save the auth token (in home directory)
 * Sets restrictive file permissions (0600) on Unix-like systems
 */
export function saveAuthToken(apiKey: string): AuthToken {
  ensureGlobalAuthDir();
  const token: AuthToken = {
    apiKey,
    createdAt: new Date().toISOString(),
  };
  const filePath = getAuthPath();
  fs.writeFileSync(filePath, JSON.stringify(token, null, 2));

  // Set restrictive permissions (read/write for owner only)
  // This works on Unix-like systems; on Windows it's a no-op
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore chmod errors on Windows or unsupported filesystems
  }

  return token;
}

/**
 * Clear the auth token
 */
export function clearAuthToken(): boolean {
  const filePath = getAuthPath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Prompt user for API key interactively
 */
export async function promptForApiKey(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.question("Enter your Letta API key: ", (answer) => {
      rl.close();
      const key = answer.trim();
      if (!key) {
        reject(new Error("API key cannot be empty"));
      } else {
        resolve(key);
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// TEAMMATE STORAGE
// ═══════════════════════════════════════════════════════════════

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
  const rootConversationId = state.mainConversationId ?? state.conversationId;
  const targets = [...(state.targets || [])];

  if (rootConversationId && !targets.some((target) => target.name === name)) {
    const createdAt = state.createdAt || new Date().toISOString();
    const lastActiveAt = state.lastUpdated || createdAt;
    targets.unshift({
      name,
      rootName: name,
      kind: 'root',
      conversationId: rootConversationId,
      createdAt,
      lastActiveAt,
      status: state.status === 'error' ? 'error' : state.status === 'working' ? 'running' : 'idle',
    });
  }

  if (state.initConversationId && !targets.some((target) => target.name === formatTargetName(name, 'memory'))) {
    const createdAt = state.initStartedAt || state.createdAt || new Date().toISOString();
    const lastActiveAt = state.initCompletedAt || state.lastUpdated || createdAt;
    targets.push({
      name: formatTargetName(name, 'memory'),
      rootName: name,
      forkName: 'memory',
      kind: 'memory',
      conversationId: state.initConversationId,
      parentTargetName: name,
      parentConversationId: rootConversationId,
      createdAt,
      lastActiveAt,
      status: state.initStatus === 'error' ? 'error' : state.initStatus === 'running' ? 'running' : 'idle',
    });
  }

  return {
    ...state,
    name,
    conversationId: rootConversationId,
    mainConversationId: rootConversationId,
    targets,
  };
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
  return state.mainConversationId ?? state.conversationId;
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
      | "todo" 
      | "role" 
      | "model"
      | "conversationId" 
      | "mainConversationId"
      | "lastUpdated"
      | "currentTask"
      | "pendingTasks"
      | "completedTasks"
      | "currentProblem"
      | "errorDetails"
      | "progress"
      | "progressNote"
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

/**
 * Update todo field (used by teammates to report progress)
 * @deprecated Use updateWork instead
 */
export function updateTodo(name: string, todo: string): TeammateState | null {
  return updateTeammate(name, { todo, currentTask: todo, status: "working" });
}

/**
 * Update status
 */
export function updateStatus(
  name: string,
  status: TeammateStatus
): TeammateState | null {
  return updateTeammate(name, { status });
}

/**
 * Update current work/task
 */
export function updateWork(
  name: string,
  work: {
    currentTask?: string;
    pendingTasks?: string[];
    completedTasks?: string[];
    progress?: number;
    progressNote?: string;
  }
): TeammateState | null {
  return updateTeammate(name, { ...work, status: "working" });
}

/**
 * Mark a task as complete and move to completedTasks
 */
export function completeTask(name: string, task: string): TeammateState | null {
  const state = loadTeammate(name);
  if (!state) return null;

  const completedTasks = [...(state.completedTasks || []), task];
  const pendingTasks = (state.pendingTasks || []).filter(t => t !== task);

  return updateTeammate(name, {
    completedTasks,
    pendingTasks,
    currentTask: pendingTasks[0] || undefined,
    progress: pendingTasks.length === 0 ? 100 : state.progress,
    status: pendingTasks.length === 0 ? "done" : "working",
  });
}

/**
 * Report a problem/blocker
 */
export function reportProblem(
  name: string,
  problem: string
): TeammateState | null {
  return updateTeammate(name, {
    currentProblem: problem,
    status: "error",
  });
}

/**
 * Clear problem and set status back to working
 */
export function clearProblem(name: string): TeammateState | null {
  return updateTeammate(name, {
    currentProblem: undefined,
    errorDetails: undefined,
    status: "working",
  });
}

/**
 * Set error details
 */
export function setError(
  name: string,
  errorDetails: string
): TeammateState | null {
  return updateTeammate(name, {
    errorDetails,
    status: "error",
  });
}

/**
 * Add a task to the pending queue
 */
export function addPendingTask(name: string, task: string): TeammateState | null {
  const state = loadTeammate(name);
  if (!state) return null;

  const pendingTasks = [...(state.pendingTasks || []), task];
  return updateTeammate(name, { pendingTasks, status: "working" });
}

/**
 * Mark teammate as done
 */
export function markDone(name: string): TeammateState | null {
  return updateTeammate(name, {
    status: "done",
    progress: 100,
    currentTask: undefined,
    currentProblem: undefined,
  });
}

/**
 * Comprehensive progress update (used by update-progress command)
 */
export function updateProgress(
  name: string,
  options: {
    task?: string;
    progress?: number;
    note?: string;
    problem?: string;
    addPending?: string;
    completeTask?: string;
    done?: boolean;
  }
): TeammateState | null {
  const state = loadTeammate(name);
  if (!state) return null;

  // Handle add-pending
  if (options.addPending) {
    const pendingTasks = [...(state.pendingTasks || []), options.addPending];
    return updateTeammate(name, { pendingTasks, status: "working" });
  }

  // Handle complete-task
  if (options.completeTask) {
    const completedTasks = [...(state.completedTasks || []), options.completeTask];
    const pendingTasks = (state.pendingTasks || []).filter(t => t !== options.completeTask);
    return updateTeammate(name, {
      completedTasks,
      pendingTasks,
      currentTask: pendingTasks[0] || undefined,
      status: pendingTasks.length === 0 ? "done" : "working",
    });
  }

  // Handle done flag
  if (options.done) {
    return updateTeammate(name, {
      status: "done",
      progress: 100,
      currentTask: undefined,
      currentProblem: undefined,
    });
  }

  // Handle problem
  if (options.problem) {
    return updateTeammate(name, {
      currentProblem: options.problem,
      status: "error",
    });
  }

  // Handle regular progress update
  const updates: Partial<TeammateState> = { status: "working" };
  if (options.task !== undefined) {
    updates.currentTask = options.task;
    updates.todo = options.task; // Keep legacy field in sync
  }
  if (options.progress !== undefined) {
    updates.progress = Math.min(100, Math.max(0, options.progress));
  }
  if (options.note !== undefined) {
    updates.progressNote = options.note;
  }

  return updateTeammate(name, updates);
}

// ═══════════════════════════════════════════════════════════════
// DAEMON TASK STORAGE
// ═══════════════════════════════════════════════════════════════

const TASKS_FILE = "tasks.json";

/**
 * Get the path to tasks.json (project-local)
 */
export function getTasksPath(): string {
  return path.join(getLteamsDir(), TASKS_FILE);
}

/**
 * Load all tasks from tasks.json
 */
export function loadTasks(): Record<string, TaskState> {
  const filePath = getTasksPath();
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Record<string, TaskState>;
  } catch {
    return {};
  }
}

/**
 * Save all tasks to tasks.json
 */
export function saveTasks(tasks: Record<string, TaskState>): void {
  ensureLteamsDir();
  const filePath = getTasksPath();
  fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2));
}

/**
 * Get a single task by ID
 */
export function getTask(taskId: string): TaskState | null {
  const tasks = loadTasks();
  return tasks[taskId] || null;
}

export function createTask(
  teammateName: string,
  message: string,
  metadata?: Pick<TaskState, 'rootTeammateName' | 'targetName' | 'conversationId'>,
): TaskState {
  const tasks = loadTasks();
  const taskId = generateTaskId();

  const task: TaskState = {
    id: taskId,
    teammateName,
    rootTeammateName: metadata?.rootTeammateName,
    targetName: metadata?.targetName,
    conversationId: metadata?.conversationId,
    message,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  tasks[taskId] = task;
  saveTasks(tasks);

  return task;
}

/**
 * Update a task's status and result/error
 */
export function updateTask(
  taskId: string,
  updates: Partial<Pick<TaskState, "status" | "result" | "error" | "startedAt" | "completedAt" | "toolCalls" | "conversationId" | "targetName" | "rootTeammateName">>
): TaskState | null {
  const tasks = loadTasks();
  const task = tasks[taskId];

  if (!task) {
    return null;
  }

  const updated = {
    ...task,
    ...updates,
  };

  tasks[taskId] = updated;
  saveTasks(tasks);

  return updated;
}

/**
 * List all tasks, optionally filtered by status
 */
export function listTasks(status?: TaskStatus): TaskState[] {
  const tasks = loadTasks();
  const allTasks = Object.values(tasks);

  if (status) {
    return allTasks.filter((t) => t.status === status);
  }

  return allTasks;
}

/**
 * List recent tasks (last N tasks, sorted by creation time)
 */
export function listRecentTasks(limit: number = 20): TaskState[] {
  const tasks = loadTasks();
  return Object.values(tasks)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

/**
 * Clean up old completed/errored tasks (older than N days)
 */
export function cleanupOldTasks(daysOld: number = 7): number {
  const tasks = loadTasks();
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
  let cleaned = 0;

  for (const [id, task] of Object.entries(tasks)) {
    if (
      (task.status === "done" || task.status === "error") &&
      task.completedAt &&
      new Date(task.completedAt).getTime() < cutoff
    ) {
      delete tasks[id];
      cleaned++;
    }
  }

  if (cleaned > 0) {
    saveTasks(tasks);
  }

  return cleaned;
}

/**
 * Find tasks that would be pruned (completed/errored and older than N days)
 */
export function findTasksToPrune(daysOld: number = 7): TaskState[] {
  const tasks = loadTasks();
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;

  return Object.values(tasks).filter(
    (task) =>
      (task.status === "done" || task.status === "error") &&
      task.completedAt &&
      new Date(task.completedAt).getTime() < cutoff
  );
}

/**
 * Delete specific tasks by ID
 */
export function deleteTasks(taskIds: string[]): number {
  const tasks = loadTasks();
  let deleted = 0;

  for (const id of taskIds) {
    if (tasks[id]) {
      delete tasks[id];
      deleted++;
    }
  }

  if (deleted > 0) {
    saveTasks(tasks);
  }

  return deleted;
}

/**
 * Find idle teammates (no activity in N days)
 */
export function findIdleTeammates(daysOld: number = 7): TeammateState[] {
  const teammates = listTeammates();
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;

  return teammates.filter((t) => {
    // Skip if currently working
    if (t.status === "working") return false;
    // Check last activity
    const lastActivity = t.lastUpdated || t.createdAt;
    return lastActivity && new Date(lastActivity).getTime() < cutoff;
  });
}

/**
 * Find broken teammates (no conversation ID)
 */
export function findBrokenTeammates(): TeammateState[] {
  const teammates = listTeammates();
  return teammates.filter((t) => !getRootConversationId(t));
}

/**
 * Delete teammates by name
 */
export function deleteTeammates(names: string[]): number {
  let deleted = 0;
  for (const name of names) {
    if (teammateExists(name)) {
      removeTeammate(name);
      deleted++;
    }
  }
  return deleted;
}

/**
 * Generate a unique task ID
 */
function generateTaskId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `task-${timestamp}-${random}`;
}
