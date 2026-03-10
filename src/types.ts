/**
 * Teammate state stored in .lteams/<name>.json
 */
export interface TeammateState {
  // === Identity ===
  /** Name of the teammate (filename without .json) */
  name: string;
  /** Role/description of the teammate */
  role: string;
  /** Letta agent ID */
  agentId: string;
  /** Conversation ID (for resuming specific conversations) */
  conversationId?: string;
  /** Model used by the agent */
  model?: string;

  // === Memfs Configuration ===
  /** Whether memfs (git-backed memory) is enabled */
  memfsEnabled?: boolean;
  /** Memfs startup mode */
  memfsStartup?: MemfsStartup;

  // === Status ===
  /** Current status */
  status: TeammateStatus;

  // === Work Tracking ===
  /** What they're currently working on */
  currentTask?: string;
  /** Queue of pending tasks */
  pendingTasks?: string[];
  /** Completed tasks */
  completedTasks?: string[];

  // === Problem Tracking ===
  /** Current blocker/issue they're stuck on */
  currentProblem?: string;
  /** Full error details if status is "error" */
  errorDetails?: string;

  // === Progress ===
  /** Progress percentage (0-100) */
  progress?: number;
  /** Human-readable progress note (e.g., "3 of 5 files processed") */
  progressNote?: string;

  // === Legacy (kept for backwards compatibility) ===
  /** @deprecated Use currentTask instead */
  todo?: string;

  // === Timestamps ===
  /** ISO timestamp of last update */
  lastUpdated: string;
  /** ISO timestamp of creation */
  createdAt: string;
}

export type TeammateStatus = "working" | "idle" | "done" | "error";

/**
 * Memfs startup modes
 */
export type MemfsStartup = "blocking" | "background" | "skip";

/**
 * Valid memfs startup values for validation
 */
export const MEMFS_STARTUP_VALUES: readonly MemfsStartup[] = ["blocking", "background", "skip"] as const;

/**
 * Parse and validate memfs-startup option
 * @param value - The raw string value from CLI options
 * @returns Validated MemfsStartup value, or undefined if not provided
 * @throws Error if value is invalid
 */
export function parseMemfsStartup(value: string | undefined): MemfsStartup | undefined{
  if (value === undefined) {
    return undefined;
  }
  if (!MEMFS_STARTUP_VALUES.includes(value as MemfsStartup)) {
    throw new Error(
      `Invalid memfs-startup mode '${value}'. Must be one of: ${MEMFS_STARTUP_VALUES.join(", ")}`
    );
  }
  return value as MemfsStartup;
}

// ═══════════════════════════════════════════════════════════════
// DAEMON TASK TYPES
// ═══════════════════════════════════════════════════════════════

/**
 * Task status for daemon operations
 */
export type TaskStatus = "pending" | "running" | "done" | "error";

/**
 * A single tool call event
 */
export interface ToolCallEvent {
  /** Tool name */
  name: string;
  /** Brief description or input summary */
  input?: string;
  /** Whether the tool call succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Task state stored in tasks.json
 */
export interface TaskState {
  /** Unique task ID */
  id: string;
  /** Name of the teammate */
  teammateName: string;
  /** Message/task sent to the teammate */
  message: string;
  /** Current status */
  status: TaskStatus;
  /** Result from the agent (when done) */
  result?: string;
  /** Error message (when error) */
  error?: string;
  /** ISO timestamp when task was created */
  createdAt: string;
  /** ISO timestamp when task started running */
  startedAt?: string;
  /** ISO timestamp when task completed */
  completedAt?: string;
  /** Tool calls made during execution */
  toolCalls?: ToolCallEvent[];
}

/**
 * IPC message types for daemon communication
 */
export type DaemonMessage =
  | { type: "dispatch"; teammateName: string; message: string; projectDir: string }
  | { type: "spawn"; name: string; role: string; model?: string; projectDir: string }
  | { type: "status"; taskId?: string; projectDir: string }
  | { type: "list"; projectDir: string }
  | { type: "stop" };

/**
 * IPC response types from daemon
 */
export type DaemonResponse =
  | { type: "accepted"; taskId: string }
  | { type: "spawned"; teammate: TeammateState }
  | { type: "task"; task: TaskState }
  | { type: "tasks"; tasks: TaskState[] }
  | { type: "error"; message: string }
  | { type: "stopped" };
