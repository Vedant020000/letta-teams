/**
 * Task storage - CRUD operations for daemon task state
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TaskKind, TaskState, TaskStatus, TeammateState } from "../types.js";
import { ensureLteamsDir, getLteamsDir, getRootConversationId, listTeammates, loadTeammate, removeTeammate, teammateExists } from "./teammate.js";

const TASKS_FILE = "tasks.json";

export interface StaleRunningInitTask {
  teammate: TeammateState;
  task: TaskState;
}

// ═══════════════════════════════════════════════════════════════
// TASK STORAGE
// ═══════════════════════════════════════════════════════════════

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
  metadata?: Pick<TaskState, 'rootTeammateName' | 'targetName' | 'conversationId'> & { kind?: TaskKind },
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
    kind: metadata?.kind,
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
  updates: Partial<Pick<TaskState, "status" | "result" | "error" | "startedAt" | "completedAt" | "toolCalls" | "conversationId" | "targetName" | "rootTeammateName" | "initEvents" | "kind">>
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

// ═══════════════════════════════════════════════════════════════
// TEAMMATE QUERIES
// ═══════════════════════════════════════════════════════════════

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
 * Find stale init tasks where teammate init is still marked running but
 * the init task has exceeded max age and remains pending/running.
 */
export function findStaleRunningInitTasks(maxAgeMinutes: number): StaleRunningInitTask[] {
  const teammates = listTeammates();
  const tasks = loadTasks();
  const cutoffMs = Date.now() - maxAgeMinutes * 60 * 1000;

  return teammates.flatMap((teammate) => {
    if (teammate.initStatus !== 'running' || !teammate.initTaskId || !teammate.initStartedAt) {
      return [];
    }

    const startedAtMs = new Date(teammate.initStartedAt).getTime();
    if (Number.isNaN(startedAtMs) || startedAtMs >= cutoffMs) {
      return [];
    }

    const task = tasks[teammate.initTaskId];
    if (!task || (task.status !== 'pending' && task.status !== 'running')) {
      return [];
    }

    return [{ teammate, task }];
  });
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a unique task ID
 */
function generateTaskId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `task-${timestamp}-${random}`;
}
