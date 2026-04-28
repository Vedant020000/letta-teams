/**
 * TODO and status event storage - operations for todo items and status tracking
 */

import type {
  StatusEvent,
  StatusEventType,
  StatusPhase,
  TeammateExecutionStatus,
  TeammateState,
  TeammateStatus,
  TodoItem,
  TodoPriority,
} from "../types.js";
import { listTeammates, loadTeammate, updateTeammate } from "./teammate.js";

const MAX_STATUS_EVENTS = 100;

export interface UpdateStatusSummaryInput {
  phase: StatusPhase;
  message: string;
  progress?: number;
  currentTodoId?: string;
  filesTouched?: string[];
  testsRun?: string;
  blockedReason?: string;
  codeChange?: boolean;
  eventType?: StatusEventType;
}

// ═══════════════════════════════════════════════════════════════
// STATUS FUNCTIONS
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// TODO FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Add a TODO item
 */
export function addTodo(
  name: string,
  input: { title: string; priority?: TodoPriority; notes?: string },
): TeammateState | null {
  const state = loadTeammate(name);
  if (!state) return null;

  const now = new Date().toISOString();
  const todo: TodoItem = {
    id: generateStatusEventId().replace('evt-', 'todo-'),
    title: input.title,
    state: 'pending',
    priority: input.priority,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };

  return updateTeammate(name, {
    todoItems: [...(state.todoItems || []), todo],
    status: state.status,
  });
}

/**
 * List TODO items
 */
export function listTodoItems(name: string): TodoItem[] {
  const state = loadTeammate(name);
  return state?.todoItems || [];
}

/**
 * Start working on a TODO item
 */
export function startTodo(
  name: string,
  todoId: string,
  options?: { message?: string },
): TeammateState | null {
  const state = loadTeammate(name);
  if (!state) return null;

  const todoItems = [...(state.todoItems || [])];
  const index = requireTodo(name, todoItems, todoId);
  const now = new Date().toISOString();
  todoItems[index] = {
    ...todoItems[index],
    state: 'in_progress',
    startedAt: todoItems[index].startedAt || now,
    blockedReason: undefined,
    updatedAt: now,
  };

  const message = options?.message || `Started: ${todoItems[index].title}`;
  return updateStatusSummary(name, {
    phase: 'implementing',
    message,
    currentTodoId: todoId,
    eventType: 'started',
  }, { todoItemsOverride: todoItems });
}

export function blockTodo(
  name: string,
  todoId: string,
  reason: string,
  options?: { message?: string },
): TeammateState | null {
  const state = loadTeammate(name);
  if (!state) return null;

  const todoItems = [...(state.todoItems || [])];
  const index = requireTodo(name, todoItems, todoId);
  const now = new Date().toISOString();
  todoItems[index] = {
    ...todoItems[index],
    state: 'blocked',
    blockedReason: reason,
    updatedAt: now,
  };

  return updateStatusSummary(name, {
    phase: 'blocked',
    message: options?.message || `Blocked: ${todoItems[index].title}`,
    currentTodoId: todoId,
    blockedReason: reason,
    eventType: 'blocked',
  }, { todoItemsOverride: todoItems });
}

export function unblockTodo(
  name: string,
  todoId: string,
  options?: { message?: string },
): TeammateState | null {
  const state = loadTeammate(name);
  if (!state) return null;

  const todoItems = [...(state.todoItems || [])];
  const index = requireTodo(name, todoItems, todoId);
  const now = new Date().toISOString();
  todoItems[index] = {
    ...todoItems[index],
    state: 'in_progress',
    blockedReason: undefined,
    updatedAt: now,
  };

  return updateStatusSummary(name, {
    phase: 'implementing',
    message: options?.message || `Unblocked: ${todoItems[index].title}`,
    currentTodoId: todoId,
    eventType: 'unblocked',
  }, { todoItemsOverride: todoItems });
}

export function completeTodo(
  name: string,
  todoId: string,
  options?: { message?: string },
): TeammateState | null {
  const state = loadTeammate(name);
  if (!state) return null;

  const todoItems = [...(state.todoItems || [])];
  const index = requireTodo(name, todoItems, todoId);
  const now = new Date().toISOString();
  todoItems[index] = {
    ...todoItems[index],
    state: 'done',
    completedAt: now,
    blockedReason: undefined,
    updatedAt: now,
  };

  const hasOpen = todoItems.some((t) => t.state !== 'done' && t.state !== 'dropped');
  return updateStatusSummary(name, {
    phase: hasOpen ? 'implementing' : 'done',
    message: options?.message || `Completed: ${todoItems[index].title}`,
    currentTodoId: hasOpen ? todoId : undefined,
    progress: hasOpen ? undefined : 100,
    eventType: 'done',
  }, { todoItemsOverride: todoItems });
}

export function dropTodo(
  name: string,
  todoId: string,
  options?: { reason?: string },
): TeammateState | null {
  const state = loadTeammate(name);
  if (!state) return null;

  const todoItems = [...(state.todoItems || [])];
  const index = requireTodo(name, todoItems, todoId);
  const now = new Date().toISOString();
  todoItems[index] = {
    ...todoItems[index],
    state: 'dropped',
    blockedReason: options?.reason,
    updatedAt: now,
  };

  return updateTeammate(name, { todoItems });
}

// ═══════════════════════════════════════════════════════════════
// STATUS SUMMARY & EVENTS
// ═══════════════════════════════════════════════════════════════

function appendStatusEvent(
  state: TeammateState,
  event: StatusEvent,
): StatusEvent[] {
  const events = [...(state.statusEvents || []), event];
  if (events.length <= MAX_STATUS_EVENTS) return events;
  return events.slice(events.length - MAX_STATUS_EVENTS);
}

export function updateStatusSummary(
  name: string,
  input: UpdateStatusSummaryInput,
  options?: { todoItemsOverride?: TodoItem[] },
): TeammateState | null {
  const state = loadTeammate(name);
  if (!state) return null;

  const now = new Date().toISOString();
  const summary: TeammateExecutionStatus = {
    phase: input.phase,
    message: input.message,
    progress: clampProgress(input.progress),
    currentTodoId: input.currentTodoId,
    lastHeartbeatAt: now,
    lastCodeChangeAt: input.codeChange ? now : state.statusSummary?.lastCodeChangeAt,
    updatedAt: now,
  };

  const event: StatusEvent = {
    id: generateStatusEventId(),
    ts: now,
    type: inferEventType(input),
    phase: input.phase,
    message: input.message,
    todoId: input.currentTodoId,
    filesTouched: input.filesTouched,
    testsRun: input.testsRun,
    blockedReason: input.blockedReason,
  };

  const statusEvents = appendStatusEvent(state, event);

  return updateTeammate(name, {
    status: mapPhaseToTeammateStatus(input.phase),
    statusSummary: summary,
    statusEvents,
    ...(options?.todoItemsOverride ? { todoItems: options.todoItemsOverride } : {}),
    errorDetails: input.phase === 'blocked' ? input.blockedReason : undefined,
  });
}

export function getRecentStatusEvents(name: string, limit: number = 20): StatusEvent[] {
  const state = loadTeammate(name);
  if (!state?.statusEvents) return [];

  const events = state.statusEvents;
  if (limit <= 0) return [];

  // statusEvents are appended in chronological order, so take the tail and reverse.
  // This avoids timestamp-tie instability when multiple events share the same millisecond.
  return events.slice(Math.max(0, events.length - limit)).reverse();
}

export function findStaleTeammates(maxSilentMinutes: number): TeammateState[] {
  const teammates = listTeammates();
  const cutoffMs = Date.now() - maxSilentMinutes * 60 * 1000;

  return teammates.filter((teammate) => {
    const heartbeat = teammate.statusSummary?.lastHeartbeatAt;
    if (!heartbeat) return false;
    const heartbeatMs = new Date(heartbeat).getTime();
    return heartbeatMs < cutoffMs && teammate.status !== 'done';
  });
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function clampProgress(progress?: number): number | undefined {
  if (progress === undefined) return undefined;
  return Math.min(100, Math.max(0, progress));
}

function mapPhaseToTeammateStatus(phase: StatusPhase): TeammateStatus {
  if (phase === 'blocked') return 'error';
  if (phase === 'done') return 'done';
  if (phase === 'idle') return 'idle';
  return 'working';
}

function inferEventType(input: UpdateStatusSummaryInput): StatusEventType {
  if (input.eventType) return input.eventType;
  if (input.phase === 'blocked') return 'blocked';
  if (input.phase === 'done') return 'done';
  if (input.codeChange) return 'code_change';
  if (input.testsRun) return 'test';
  return 'progress';
}

function generateStatusEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `evt-${timestamp}-${random}`;
}

function findTodoIndex(todoItems: TodoItem[], todoId: string): number {
  return todoItems.findIndex((item) => item.id === todoId);
}

function requireTodo(name: string, todoItems: TodoItem[], todoId: string): number {
  const index = findTodoIndex(todoItems, todoId);
  if (index === -1) {
    throw new Error(`Todo '${todoId}' not found for teammate '${name}'`);
  }
  return index;
}
