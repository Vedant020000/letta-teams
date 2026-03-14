import { execFileSync, execSync } from "node:child_process";
import { dirname } from "node:path";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TeammateState } from "./types.js";
import { getMemoryConversationId } from "./store.js";

export const MEMORY_FS_ROOT = ".letta";
export const MEMORY_FS_AGENTS_DIR = "agents";
export const MEMORY_FS_MEMORY_DIR = "memory";
export const MEMORY_SYSTEM_DIR = "system";

const OWNED_MEMFS_FILES = [
  "system/teammate/identity.md",
  "system/teammate/role.md",
  "system/project/context.md",
  "system/init/status.md",
] as const;

let gitExec: typeof execFileSync = execFileSync;

export function setMemfsGitExecutor(executor: typeof execFileSync): void {
  gitExec = executor;
}

export function resetMemfsGitExecutor(): void {
  gitExec = execFileSync;
}

export function getMemoryFilesystemRoot(
  agentId: string,
  homeDir: string = homedir(),
): string {
  return join(homeDir, MEMORY_FS_ROOT, MEMORY_FS_AGENTS_DIR, agentId, MEMORY_FS_MEMORY_DIR);
}

export function getOwnedMemfsFiles(): string[] {
  return [...OWNED_MEMFS_FILES];
}

export function getMemorySystemDir(
  agentId: string,
  homeDir: string = homedir(),
): string {
  return join(getMemoryFilesystemRoot(agentId, homeDir), MEMORY_SYSTEM_DIR);
}

export function ensureMemoryFilesystemDirs(
  agentId: string,
  homeDir: string = homedir(),
): void {
  const root = getMemoryFilesystemRoot(agentId, homeDir);
  const systemDir = getMemorySystemDir(agentId, homeDir);

  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  if (!existsSync(systemDir)) {
    mkdirSync(systemDir, { recursive: true });
  }
}

function writeMemoryFile(agentId: string, relativePath: string, content: string): void {
  const fullPath = join(getMemoryFilesystemRoot(agentId), relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

function renderFrontmatter(description: string, limit: number = 1200): string {
  return `---
description: ${description}
limit: ${limit}
---`;
}

function gatherGitContext(): string {
  try {
    const cwd = process.cwd();
    execSync("git rev-parse --git-dir", { cwd, stdio: "pipe" });
    const branch = execSync("git branch --show-current", {
      cwd,
      encoding: "utf-8",
    }).trim();
    const status = execSync("git status --short", {
      cwd,
      encoding: "utf-8",
    }).trim();

    return `- branch: ${branch}\n- status: ${status || "(clean)"}`;
  } catch {
    return "(not a git repository)";
  }
}

function gatherDirListing(): string {
  try {
    const cwd = process.cwd();
    const entries = readdirSync(cwd, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("."))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 25);

    return entries
      .map((entry) => `${entry.isDirectory() ? "- dir" : "- file"}: ${entry.name}`)
      .join("\n");
  } catch {
    return "";
  }
}

export function scaffoldTeammateMemfs(
  state: TeammateState,
  options: { identityOnly?: boolean } = {},
): void {
  if (!state.memfsEnabled) return;

  ensureMemoryFilesystemDirs(state.agentId);

  writeMemoryFile(
    state.agentId,
    "system/teammate/identity.md",
    `${renderFrontmatter("Stable identity for this spawned teammate.")}

## Identity
- Name: ${state.name}
- Role: ${state.role}
- Agent ID: ${state.agentId}
- Created At: ${state.createdAt}
`,
  );

  if (options.identityOnly) {
    return;
  }

  writeMemoryFile(
    state.agentId,
    "system/teammate/role.md",
    `${renderFrontmatter("Durable role definition and scope boundaries for this teammate.")}

## Role
${state.role}

## Specialization prompt
${state.spawnPrompt || "No extra specialization prompt was provided."}

## Guidance
- Stay focused on this role.
- Prefer durable heuristics over transient task notes.
- Avoid drifting into unrelated domains.
`,
  );

  writeMemoryFile(
    state.agentId,
    "system/project/context.md",
    `${renderFrontmatter("Project-level context captured at teammate spawn time.")}

## Working directory
${process.cwd()}

## Git
${gatherGitContext()}

## Top-level listing
${gatherDirListing() || "(unavailable)"}
`,
  );

  writeMemoryFile(
    state.agentId,
    "system/init/status.md",
    `${renderFrontmatter("Initialization lifecycle status for this teammate.")}

## Initialization
- Status: ${state.initStatus || "pending"}
- Init task ID: ${state.initTaskId || "pending"}
- Init started at: ${state.initStartedAt || "not started"}
- Init completed at: ${state.initCompletedAt || "not completed"}
- Init error: ${state.initError || "none"}
`,
  );
}

function runGit(agentId: string, args: string[]): string {
  return gitExec("git", args, {
    cwd: getMemoryFilesystemRoot(agentId),
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function isMemfsGitRepo(
  agentId: string,
  homeDir: string = homedir(),
): boolean {
  return existsSync(join(getMemoryFilesystemRoot(agentId, homeDir), ".git"));
}

export function syncOwnedMemfsFiles(
  state: TeammateState,
  reason: string,
): { synced: boolean; committed: boolean; timestamp?: string } {
  if (!state.memfsEnabled) {
    return { synced: false, committed: false };
  }

  if (!isMemfsGitRepo(state.agentId)) {
    throw new Error(
      `Memfs repo is not initialized for ${state.name} at ${getMemoryFilesystemRoot(state.agentId)}`,
    );
  }

  const ownedFiles = getOwnedMemfsFiles();
  runGit(state.agentId, ["add", "--", ...ownedFiles]);

  const diffCached = runGit(state.agentId, ["diff", "--cached", "--name-only", "--", ...ownedFiles]);
  if (!diffCached) {
    return { synced: true, committed: false };
  }

  const message = `chore(memfs): ${reason} for ${state.name}`;
  runGit(state.agentId, ["commit", "-m", message]);
  try {
    runGit(state.agentId, ["push"]);
  } catch (pushError) {
    try {
      runGit(state.agentId, ["push"]);
    } catch {
      try {
        runGit(state.agentId, ["pull", "--rebase"]);
        runGit(state.agentId, ["push"]);
      } catch (recoveryError) {
        const originalMessage = pushError instanceof Error ? pushError.message : String(pushError);
        const recoveryMessage = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
        throw new Error(`Memfs git push failed. Initial push error: ${originalMessage}. Recovery attempt (pull --rebase + push) failed: ${recoveryMessage}`);
      }
    }
  }

  return {
    synced: true,
    committed: true,
    timestamp: new Date().toISOString(),
  };
}

export function updateTeammateInitScaffold(state: TeammateState): void {
  if (!state.memfsEnabled) return;
  ensureMemoryFilesystemDirs(state.agentId);

  const memoryConversationId = getMemoryConversationId(state.name);

  writeMemoryFile(
    state.agentId,
    "system/init/status.md",
    `${renderFrontmatter("Initialization lifecycle status for this teammate.")}

## Initialization
- Status: ${state.initStatus || "pending"}
- Init task ID: ${state.initTaskId || "pending"}
- Init conversation ID: ${memoryConversationId || "none"}
- Init started at: ${state.initStartedAt || "not started"}
- Init completed at: ${state.initCompletedAt || "not completed"}
- Selected specialization: ${state.selectedSpecTitle || "none"}
- Init error: ${state.initError || "none"}
`,
  );
}