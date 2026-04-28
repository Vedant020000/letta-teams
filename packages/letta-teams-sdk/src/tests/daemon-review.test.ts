import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { setProjectDir } from '../store.js';
import { createTask, listTasks, getTask } from '../store/task.js';
import { processTask } from '../daemon.js';

vi.mock('../agent.js', async () => {
  const actual = await vi.importActual('../agent.js');
  return {
    ...actual,
    messageTeammate: vi.fn(async () => 'ok'),
  };
});

describe('processTask review pipeline', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-review-'));
    setProjectDir(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('creates review task after worker completion', async () => {
    const pipelineId = 'pipeline-test';
    const review = {
      reviewer: 'reviewer',
      gate: 'on_success' as const,
      template: undefined,
      assignments: [{ name: 'worker', message: 'do work' }],
    };

    const task = createTask('worker', 'task msg', { pipelineId });

    await processTask(task.id, 'worker', 'task msg', { pipelineId, review });

    const updatedTask = getTask(task.id);
    expect(updatedTask?.status).toBe('pending_review');

    const allTasks = listTasks();
    const reviewTask = allTasks.find((t) => t.pipelineId === pipelineId && t.id !== task.id);
    expect(reviewTask).toBeDefined();
  });
});