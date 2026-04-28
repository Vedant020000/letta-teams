import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Import store functions
import {
  getLteamsDir,
  ensureLteamsDir,
  getTeammatePath,
  teammateExists,
  loadTeammate,
  saveTeammate,
  updateTeammate,
  removeTeammate,
  listTeammates,
  updateStatus,
} from '../store.js';
import type { TeammateState } from '../types.js';

// Helper to create temp directory
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'letta-teams-test-'));
}

describe('store', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Save original cwd and create temp directory
    originalCwd = process.cwd();
    tempDir = createTempDir();
    process.chdir(tempDir);
  });

  afterEach(() => {
    // Restore original cwd and cleanup
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getLteamsDir', () => {
    it('should return .lteams path in current working directory', () => {
      const result = getLteamsDir();
      expect(result).toBe(path.join(tempDir, '.lteams'));
    });
  });

  describe('ensureLteamsDir', () => {
    it('should create .lteams directory if it does not exist', () => {
      ensureLteamsDir();
      expect(fs.existsSync(getLteamsDir())).toBe(true);
    });

    it('should not throw if directory already exists', () => {
      ensureLteamsDir();
      expect(() => ensureLteamsDir()).not.toThrow();
    });
  });

  describe('getTeammatePath', () => {
    it('should return correct path for teammate', () => {
      const result = getTeammatePath('researcher');
      expect(result).toBe(path.join(tempDir, '.lteams', 'researcher.json'));
    });
  });

  describe('teammateExists', () => {
    it('should return false for non-existent teammate', () => {
      expect(teammateExists('nonexistent')).toBe(false);
    });

    it('should return true for existing teammate', () => {
      ensureLteamsDir();
      const state: TeammateState = {
        name: 'researcher',
        role: 'Research assistant',
        agentId: 'agent-test123',
        status: 'idle',
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      saveTeammate(state);
      expect(teammateExists('researcher')).toBe(true);
    });
  });

  describe('saveTeammate and loadTeammate', () => {
    it('should save and load teammate state correctly', () => {
      const state: TeammateState = {
        name: 'coder',
        role: 'Software developer',
        agentId: 'agent-abc123',
        model: 'claude-sonnet-4-20250514',
        status: 'working',
        statusSummary: {
          phase: 'implementing',
          message: 'Implementing feature X',
          lastHeartbeatAt: '2026-03-06T10:00:00Z',
          updatedAt: '2026-03-06T10:00:00Z',
        },
        lastUpdated: '2026-03-06T10:00:00Z',
        createdAt: '2026-03-06T09:00:00Z',
      };

      saveTeammate(state);
      const loaded = loadTeammate('coder');

      expect(loaded).not.toBeNull();
      expect(loaded?.name).toBe('coder');
      expect(loaded?.agentId).toBe('agent-abc123');
      expect(loaded?.model).toBe('claude-sonnet-4-20250514');
      expect(loaded?.status).toBe('working');
      expect(loaded?.statusSummary?.message).toBe('Implementing feature X');
    });

    it('should return null for non-existent teammate', () => {
      expect(loadTeammate('nonexistent')).toBeNull();
    });
  });

  describe('updateTeammate', () => {
    it('should update specific fields of a teammate', () => {
      const state: TeammateState = {
        name: 'reviewer',
        role: 'Code reviewer',
        agentId: 'agent-xyz',
        status: 'idle',
        lastUpdated: '2026-03-06T09:00:00Z',
        createdAt: '2026-03-06T09:00:00Z',
      };
      saveTeammate(state);

      const updated = updateTeammate('reviewer', {
        status: 'working',
        statusSummary: {
          phase: 'reviewing',
          message: 'Reviewing PR #123',
          lastHeartbeatAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe('working');
      expect(updated?.statusSummary?.message).toBe('Reviewing PR #123');
      expect(updated?.lastUpdated).not.toBe('2026-03-06T09:00:00Z');
    });

    it('should persist memfs sync metadata while keeping teammate state in .lteams', () => {
      const state: TeammateState = {
        name: 'reviewer',
        role: 'Code reviewer',
        agentId: 'agent-xyz',
        status: 'idle',
        lastUpdated: '2026-03-06T09:00:00Z',
        createdAt: '2026-03-06T09:00:00Z',
      };
      saveTeammate(state);

      const updated = updateTeammate('reviewer', {
        memfsMemoryDir: '/home/user/.letta/agents/agent-xyz/memory',
        memfsSyncStatus: 'synced',
        memfsLastSyncedAt: '2026-03-06T10:00:00Z',
      });

      expect(updated?.memfsMemoryDir).toContain('/.letta/agents/agent-xyz/memory');
      expect(updated?.memfsSyncStatus).toBe('synced');
      expect(updated?.memfsLastSyncedAt).toBe('2026-03-06T10:00:00Z');

      const raw = fs.readFileSync(getTeammatePath('reviewer'), 'utf-8');
      expect(raw).toContain('"memfsMemoryDir"');
      expect(getTeammatePath('reviewer')).toContain(`${path.sep}.lteams${path.sep}`);
    });

    it('should return null for non-existent teammate', () => {
      expect(updateTeammate('nonexistent', { status: 'done' })).toBeNull();
    });
  });

  describe('removeTeammate', () => {
    it('should remove existing teammate', () => {
      const state: TeammateState = {
        name: 'tester',
        role: 'QA tester',
        agentId: 'agent-test',
        status: 'idle',
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      saveTeammate(state);

      expect(teammateExists('tester')).toBe(true);
      expect(removeTeammate('tester')).toBe(true);
      expect(teammateExists('tester')).toBe(false);
    });

    it('should return false for non-existent teammate', () => {
      expect(removeTeammate('nonexistent')).toBe(false);
    });
  });

  describe('listTeammates', () => {
    it('should return empty array when no teammates exist', () => {
      expect(listTeammates()).toEqual([]);
    });

    it('should return all teammates', () => {
      const teammates: TeammateState[] = [
        {
          name: 'researcher',
          role: 'Research assistant',
          agentId: 'agent-1',
          status: 'idle',
          lastUpdated: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
        {
          name: 'coder',
          role: 'Developer',
          agentId: 'agent-2',
          status: 'working',
          lastUpdated: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ];

      teammates.forEach(saveTeammate);
      const listed = listTeammates();

      expect(listed).toHaveLength(2);
      expect(listed.map((t) => t.name).sort()).toEqual(['coder', 'researcher']);
    });
  });

  describe('updateStatus', () => {
    it('should update status', () => {
      const state: TeammateState = {
        name: 'architect',
        role: 'System architect',
        agentId: 'agent-arch',
        status: 'working',
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      saveTeammate(state);

      const updated = updateStatus('architect', 'done');

      expect(updated?.status).toBe('done');
    });
  });
});
