import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock the SDK
vi.mock('@letta-ai/letta-code-sdk', () => ({
  createAgent: vi.fn(),
  createSession: vi.fn(),
  resumeSession: vi.fn(),
}));

// Import after mocking
import { createAgent, createSession, resumeSession } from '@letta-ai/letta-code-sdk';
import {
  spawnTeammate,
  messageTeammate,
  checkApiKey,
} from '../agent.js';
import { loadTeammate, saveTeammate, teammateExists, clearAuthToken } from '../store.js';
import type { TeammateState } from '../types.js';

// Helper to create temp directory
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'letta-teams-test-'));
}

describe('agent', () => {
  let tempDir: string;
  let originalCwd: string;
  let originalApiKey: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalCwd = process.cwd();
    tempDir = createTempDir();
    process.chdir(tempDir);
    // Set API key for tests
    originalApiKey = process.env.LETTA_API_KEY;
    process.env.LETTA_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    // Restore API key
    if (originalApiKey !== undefined) {
      process.env.LETTA_API_KEY = originalApiKey;
    } else {
      delete process.env.LETTA_API_KEY;
    }
    vi.restoreAllMocks();
  });

  describe('checkApiKey', () => {
    it('should not throw when LETTA_API_KEY is set', () => {
      // API key is already set in beforeEach
      expect(() => checkApiKey()).not.toThrow();
    });

    it('should throw when LETTA_API_KEY is not set', () => {
      delete process.env.LETTA_API_KEY;
      clearAuthToken(); // Clear any stored token

      expect(() => checkApiKey()).toThrow('No API key found');
    });
  });

  describe('spawnTeammate', () => {
    it('should create agent and save state', async () => {
      vi.mocked(createAgent).mockResolvedValue('agent-new123');

      const mockSession = {
        send: vi.fn().mockResolvedValue(undefined),
        stream: vi.fn().mockImplementation(async function* () {
          yield { type: 'result', result: 'OK' };
        }),
        conversationId: 'conv-123',
        [Symbol.asyncDispose]: vi.fn(),
      };
      vi.mocked(createSession).mockReturnValue(mockSession as any);

      const state = await spawnTeammate('researcher', 'Research assistant');

      expect(createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['name:researcher', 'origin:letta-teams'],
        })
      );

      expect(state.name).toBe('researcher');
      expect(state.role).toBe('Research assistant');
      expect(state.agentId).toBe('agent-new123');
      expect(state.conversationId).toBe('conv-123');
      expect(state.status).toBe('idle');
      expect(teammateExists('researcher')).toBe(true);
    });

    it('should include model when specified', async () => {
      vi.mocked(createAgent).mockResolvedValue('agent-model123');

      const mockSession = {
        send: vi.fn().mockResolvedValue(undefined),
        stream: vi.fn().mockImplementation(async function* () {
          yield { type: 'result', result: 'OK' };
        }),
        conversationId: 'conv-123',
        [Symbol.asyncDispose]: vi.fn(),
      };
      vi.mocked(createSession).mockReturnValue(mockSession as any);

      const state = await spawnTeammate('coder', 'Developer', {
        model: 'claude-sonnet-4-20250514',
      });

      expect(createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
        })
      );

      expect(state.model).toBe('claude-sonnet-4-20250514');
    });

    it('should throw error if teammate already exists', async () => {
      const existing: TeammateState = {
        name: 'existing',
        role: 'Test role',
        agentId: 'agent-old',
        status: 'idle',
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      saveTeammate(existing);

      await expect(spawnTeammate('existing', 'Test role')).rejects.toThrow(
        "Teammate 'existing' already exists. Use --force to overwrite."
      );
    });
  });

  describe('messageTeammate', () => {
    it('should throw error for non-existent teammate', async () => {
      await expect(messageTeammate('nonexistent', 'Hello')).rejects.toThrow(
        "Teammate 'nonexistent' not found"
      );
    });

    it('should throw error if no conversation ID', async () => {
      const state: TeammateState = {
        name: 'coder',
        role: 'Developer',
        agentId: 'agent-test',
        status: 'idle',
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      saveTeammate(state);

      await expect(messageTeammate('coder', 'Hello')).rejects.toThrow(
        "Teammate 'coder' has no conversation ID"
      );
    });

    it('should send message and return response', async () => {
      const state: TeammateState = {
        name: 'coder',
        role: 'Developer',
        agentId: 'agent-test',
        conversationId: 'conv-test',
        status: 'idle',
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      saveTeammate(state);

      const mockSession = {
        send: vi.fn().mockResolvedValue(undefined),
        stream: vi.fn().mockImplementation(async function* () {
          yield { type: 'result', result: 'Hello back!' };
        }),
        [Symbol.asyncDispose]: vi.fn(),
      };
      vi.mocked(resumeSession).mockReturnValue(mockSession as any);

      const response = await messageTeammate('coder', 'Hello');

      expect(resumeSession).toHaveBeenCalledWith(
        'conv-test',
        expect.objectContaining({
          permissionMode: 'bypassPermissions',
        })
      );

      expect(mockSession.send).toHaveBeenCalledWith('Hello');
      expect(response).toBe('Hello back!');

      const updated = loadTeammate('coder');
      expect(updated?.status).toBe('done');
    });
  });
});
