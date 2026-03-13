import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ensureMemoryFilesystemDirs,
  getMemoryFilesystemRoot,
  getOwnedMemfsFiles,
  isMemfsGitRepo,
  resetMemfsGitExecutor,
  setMemfsGitExecutor,
  syncOwnedMemfsFiles,
} from './memfs.js';
import type { TeammateState } from './types.js';

function createTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'letta-memfs-test-'));
}

describe('memfs', () => {
  let tempHome: string;
  let agentId: string;

  beforeEach(() => {
    tempHome = createTempHome();
    agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    resetMemfsGitExecutor();
  });

  afterEach(() => {
    resetMemfsGitExecutor();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('should expose owned memfs files under system/', () => {
    expect(getOwnedMemfsFiles()).toEqual([
      'system/teammate/identity.md',
      'system/teammate/role.md',
      'system/project/context.md',
      'system/init/status.md',
    ]);
  });

  it('should detect git repo only inside .letta memfs path', () => {
    ensureMemoryFilesystemDirs(agentId, tempHome);
    expect(isMemfsGitRepo(agentId, tempHome)).toBe(false);

    const root = getMemoryFilesystemRoot(agentId, tempHome);
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    expect(isMemfsGitRepo(agentId, tempHome)).toBe(true);
  });

  it('should stage only owned files and skip commit when no staged diff exists', () => {
    const state: TeammateState = {
      name: 'alice',
      role: 'Developer',
      agentId,
      status: 'idle',
      memfsEnabled: true,
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    ensureMemoryFilesystemDirs(agentId, os.homedir());
    fs.mkdirSync(path.join(getMemoryFilesystemRoot(agentId, os.homedir()), '.git'), { recursive: true });

    const calls: Array<{ cmd: string; args: readonly string[] | undefined; cwd?: string }> = [];
    setMemfsGitExecutor(((cmd: string, args?: readonly string[] | undefined, options?: any) => {
      calls.push({ cmd, args, cwd: options?.cwd });
      const argList = args ?? [];
      if (argList.includes('diff')) return '' as any;
      return '' as any;
    }) as any);

    const result = syncOwnedMemfsFiles(state, 'sync files');

    expect(result.synced).toBe(true);
    expect(result.committed).toBe(false);
    expect(calls).toContainEqual({
      cmd: 'git',
      args: ['add', '--', ...getOwnedMemfsFiles()],
      cwd: getMemoryFilesystemRoot(agentId, os.homedir()),
    });

    fs.rmSync(getMemoryFilesystemRoot(agentId, os.homedir()), { recursive: true, force: true });
  });

  it('should recover from push failure with pull --rebase then push', () => {
    const state: TeammateState = {
      name: 'alice',
      role: 'Developer',
      agentId,
      status: 'idle',
      memfsEnabled: true,
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    ensureMemoryFilesystemDirs(agentId, os.homedir());
    fs.mkdirSync(path.join(getMemoryFilesystemRoot(agentId, os.homedir()), '.git'), { recursive: true });

    let pushAttempts = 0;
    const calls: string[][] = [];
    setMemfsGitExecutor(((cmd: string, args?: readonly string[] | undefined) => {
      const argList = [...(args ?? [])] as string[];
      calls.push(argList);
      if (argList[0] === 'diff') return 'system/init/status.md' as any;
      if (argList[0] === 'push') {
        pushAttempts += 1;
        if (pushAttempts <= 2) {
          throw new Error('push rejected');
        }
      }
      return '' as any;
    }) as any);

    const result = syncOwnedMemfsFiles(state, 'sync files');

    expect(result.synced).toBe(true);
    expect(result.committed).toBe(true);
    expect(calls).toContainEqual(['pull', '--rebase']);

    fs.rmSync(getMemoryFilesystemRoot(agentId, os.homedir()), { recursive: true, force: true });
  });

  it('should throw a clear error if push recovery also fails', () => {
    const state: TeammateState = {
      name: 'alice',
      role: 'Developer',
      agentId,
      status: 'idle',
      memfsEnabled: true,
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    ensureMemoryFilesystemDirs(agentId, os.homedir());
    fs.mkdirSync(path.join(getMemoryFilesystemRoot(agentId, os.homedir()), '.git'), { recursive: true });

    setMemfsGitExecutor(((cmd: string, args?: readonly string[] | undefined) => {
      const argList = [...(args ?? [])] as string[];
      if (argList[0] === 'diff') return 'system/init/status.md' as any;
      if (argList[0] === 'push') {
        throw new Error('push rejected');
      }
      if (argList[0] === 'pull') {
        throw new Error('rebase conflict');
      }
      return '' as any;
    }) as any);

    expect(() => syncOwnedMemfsFiles(state, 'sync files')).toThrow(
      /Memfs git push failed/,
    );

    fs.rmSync(getMemoryFilesystemRoot(agentId, os.homedir()), { recursive: true, force: true });
  });
});