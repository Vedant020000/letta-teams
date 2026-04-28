import { describe, it, expect } from 'vitest';
import { filterVisibleTasks, inferTaskKind, isInternalTask } from './task-visibility.js';
import type { TaskState } from './types.js';

function buildTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    id: overrides.id ?? 'task-1',
    teammateName: overrides.teammateName ?? 'agent',
    message: overrides.message ?? 'do work',
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    kind: overrides.kind,
    completedAt: overrides.completedAt,
    error: overrides.error,
    result: overrides.result,
    startedAt: overrides.startedAt,
    targetName: overrides.targetName,
    rootTeammateName: overrides.rootTeammateName,
    conversationId: overrides.conversationId,
    initEvents: overrides.initEvents,
    toolCalls: overrides.toolCalls,
  };
}

describe('task visibility helpers', () => {
  it('infers internal init/reinit kinds from message prefixes', () => {
    expect(inferTaskKind(buildTask({ message: '[internal init] bootstrap memory' }))).toBe('internal_init');
    expect(inferTaskKind(buildTask({ message: '[internal reinit] refresh memory' }))).toBe('internal_reinit');
    expect(inferTaskKind(buildTask({ message: 'normal user prompt' }))).toBe('work');
  });

  it('treats explicit internal kinds as internal', () => {
    expect(isInternalTask(buildTask({ kind: 'internal_init' }))).toBe(true);
    expect(isInternalTask(buildTask({ kind: 'internal_reinit' }))).toBe(true);
    expect(isInternalTask(buildTask({ kind: 'work' }))).toBe(false);
  });

  it('hides internal tasks by default and shows them when requested', () => {
    const tasks: TaskState[] = [
      buildTask({ id: 'w1', message: 'build feature', kind: 'work' }),
      buildTask({ id: 'i1', message: '[internal init] setup' }),
      buildTask({ id: 'r1', message: '[internal reinit] repair' }),
    ];

    expect(filterVisibleTasks(tasks, false).map(t => t.id)).toEqual(['w1']);
    expect(filterVisibleTasks(tasks, true).map(t => t.id)).toEqual(['w1', 'i1', 'r1']);
  });
});
