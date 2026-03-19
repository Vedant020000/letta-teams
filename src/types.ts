/**
 * Teammate state stored in .lteams/<name>.json
 */
export type ConversationTargetKind = 'root' | 'memory' | 'custom';

export interface ConversationTargetState {
  /** Full target name, e.g. alice or alice/memory */
  name: string;
  /** Root teammate name */
  rootName: string;
  /** Fork segment for non-root targets */
  forkName?: string;
  /** Target kind */
  kind: ConversationTargetKind;
  /** Conversation ID used for this target */
  conversationId: string;
  /** Parent target name if this is a fork */
  parentTargetName?: string;
  /** Parent conversation ID if this is a fork */
  parentConversationId?: string;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last activity */
  lastActiveAt: string;
  /** Lightweight status for display */
  status?: 'idle' | 'running' | 'error';
}

export interface TeammateState {
  // === Identity ===
  /** Name of the teammate (filename without .json) */
  name: string;
  /** Role/description of the teammate */
  role: string;
  /** Letta agent ID */
  agentId: string;
  /** Model used by the agent */
  model?: string;
  /** Rich spawn prompt used for background memory initialization */
  spawnPrompt?: string;
  /** All conversation targets for this teammate */
  targets?: ConversationTargetState[];

  // === Memfs Configuration ===
  /** Whether memfs (git-backed memory) is enabled */
  memfsEnabled?: boolean;
  /** Memfs startup mode */
  memfsStartup?: MemfsStartup;
  /** Letta memfs repo path under ~/.letta/... (never .lteams/) */
  memfsMemoryDir?: string;
  /** Memfs sync lifecycle state for system-owned scaffold files */
  memfsSyncStatus?: MemfsSyncStatus;
  /** Last memfs sync success timestamp */
  memfsLastSyncedAt?: string;
  /** Last memfs sync error, if any */
  memfsSyncError?: string;

  // === Status ===
  /** Current status */
  status: TeammateStatus;

  // === TODO + STATUS Channels ===
  /** Durable task ownership for this teammate */
  todoItems?: TodoItem[];
  /** Current execution summary (heartbeat) */
  statusSummary?: TeammateExecutionStatus;
  /** Recent execution events (bounded ring buffer in store) */
  statusEvents?: StatusEvent[];

  // === Error Details ===
  /** Optional high-level error details when coarse status is "error" */
  errorDetails?: string;

  // === Initialization ===
  /** Background initialization status */
  initStatus?: InitStatus;
  /** Background init task ID */
  initTaskId?: string;
  /** Error captured during initialization */
  initError?: string;
  /** Selected specialization summary from init */
  selectedSpecTitle?: string;
  /** ISO timestamp when init started */
  initStartedAt?: string;
  /** ISO timestamp when init completed */
  initCompletedAt?: string;

  // === Timestamps ===
  /** ISO timestamp of last update */
  lastUpdated: string;
  /** ISO timestamp of creation */
  createdAt: string;
}

export type TeammateStatus = "working" | "idle" | "done" | "error";
export type InitStatus = "pending" | "running" | "done" | "error" | "skipped";

export type TodoState = 'pending' | 'in_progress' | 'blocked' | 'done' | 'dropped';
export type TodoPriority = 'low' | 'medium' | 'high';

export interface TodoItem {
  id: string;
  title: string;
  state: TodoState;
  priority?: TodoPriority;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  blockedReason?: string;
  notes?: string;
}

export type StatusPhase = 'idle' | 'planning' | 'implementing' | 'testing' | 'reviewing' | 'blocked' | 'done';
export type StatusEventType = 'started' | 'progress' | 'code_change' | 'test' | 'blocked' | 'unblocked' | 'done' | 'heartbeat';

export interface StatusEvent {
  id: string;
  ts: string;
  type: StatusEventType;
  phase: StatusPhase;
  message: string;
  todoId?: string;
  filesTouched?: string[];
  testsRun?: string;
  blockedReason?: string;
}

export interface TeammateExecutionStatus {
  phase: StatusPhase;
  message: string;
  progress?: number;
  currentTodoId?: string;
  lastHeartbeatAt: string;
  lastCodeChangeAt?: string;
  updatedAt: string;
}

/**
 * Memfs startup modes
 */
export type MemfsStartup = "blocking" | "background" | "skip";
export type MemfsSyncStatus = "idle" | "syncing" | "synced" | "error";

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
 * Task kind for distinguishing user-facing work from internal lifecycle tasks
 */
export type TaskKind = "work" | "internal_init" | "internal_reinit";

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

export interface TaskInitEvent {
  /** ISO timestamp when the init event was recorded */
  timestamp: string;
  /** Init stream event type */
  type: "assistant" | "tool_call" | "tool_result" | "result" | "error";
  /** Optional tool name for tool_call events */
  toolName?: string;
  /** Content/snippet payload */
  content?: string;
  /** Whether tool_result event was an error */
  isError?: boolean;
}

/**
 * Task state stored in tasks.json
 */
export interface TaskState {
  /** Unique task ID */
  id: string;
  /** Routed target name (root or fork) */
  teammateName: string;
  /** Root teammate name */
  rootTeammateName?: string;
  /** Exact routed target name */
  targetName?: string;
  /** Conversation used for this task */
  conversationId?: string;
  /** Message/task sent to the teammate */
  message: string;
  /** Task kind (may be absent on legacy tasks) */
  kind?: TaskKind;
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
  /** Durable init transcript events (for init tasks) */
  initEvents?: TaskInitEvent[];
}

/**
 * IPC message types for daemon communication
 */
export type DaemonMessage =
  | { type: "dispatch"; targetName: string; message: string; projectDir: string }
  | {
      type: "spawn";
      name: string;
      role: string;
      model?: string;
      spawnPrompt?: string;
      skipInit?: boolean;
      memfsEnabled?: boolean;
      memfsStartup?: MemfsStartup;
      projectDir: string;
    }
  | {
      type: "fork";
      rootName: string;
      forkName: string;
      projectDir: string;
    }
  | {
      type: "reinit";
      rootName: string;
      prompt?: string;
      projectDir: string;
    }
  | {
      type: "council_start";
      prompt: string;
      message?: string;
      participantNames?: string[];
      maxTurns?: number;
      projectDir: string;
    }
  | { type: "kill"; name: string; projectDir: string }
  | { type: "status"; taskId?: string; projectDir: string }
  | { type: "list"; projectDir: string }
  | { type: "stop" };

/**
 * IPC response types from daemon
 */
export type DaemonResponse =
  | { type: "accepted"; taskId: string }
  | { type: "spawned"; teammate: TeammateState }
  | { type: "forked"; teammate: TeammateState; target: ConversationTargetState }
  | { type: "council_started"; sessionId: string }
  | { type: "killed"; name: string; cancelled: number }
  | { type: "task"; task: TaskState }
  | { type: "tasks"; tasks: TaskState[] }
  | { type: "error"; message: string }
  | { type: "stopped" };
