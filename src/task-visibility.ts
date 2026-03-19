import type { TaskKind, TaskState } from './types.js';

const INTERNAL_PREFIX = '[internal';

export function inferTaskKind(task: Pick<TaskState, 'kind' | 'message'>): TaskKind {
  if (task.kind) {
    return task.kind;
  }

  const normalized = task.message.trim().toLowerCase();
  if (normalized.startsWith(`${INTERNAL_PREFIX} init]`)) {
    return 'internal_init';
  }
  if (normalized.startsWith(`${INTERNAL_PREFIX} reinit]`)) {
    return 'internal_reinit';
  }

  return 'work';
}

export function isInternalTask(task: Pick<TaskState, 'kind' | 'message'>): boolean {
  const kind = inferTaskKind(task);
  return kind === 'internal_init' || kind === 'internal_reinit';
}

export function filterVisibleTasks(tasks: TaskState[], includeInternal: boolean = false): TaskState[] {
  if (includeInternal) {
    return tasks;
  }
  return tasks.filter((task) => !isInternalTask(task));
}