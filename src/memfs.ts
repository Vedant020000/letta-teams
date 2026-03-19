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
  "system/teammate/contracts.md",
  "system/teammate/playbooks.md",
  "system/teammate/quality-bar.md",
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
    "system/teammate/contracts.md",
    `${renderFrontmatter("Operational teammate contracts for TODO, STATUS, and coordination.")}

## Operating contract

You are expected to execute through durable task ownership and visible heartbeat updates.

### TODO contract

1. Represent owned work as TODO items.
2. Start TODO before implementation starts.
3. Block TODO immediately when dependency prevents progress.
4. Unblock TODO explicitly when dependency clears.
5. Mark done/drop with concise reason.

Required commands:

\`\`\`bash
letta-teams todo add ${state.name} "<work item>" --priority high
letta-teams todo start ${state.name} <todo-id> --message "starting"
letta-teams todo block ${state.name} <todo-id> --reason "<missing dependency>"
letta-teams todo unblock ${state.name} <todo-id> --message "dependency resolved"
letta-teams todo done ${state.name} <todo-id> --message "implemented + validated"
\`\`\`

### STATUS contract

Use status updates for phase/progress heartbeat and blocker visibility.

\`\`\`bash
letta-teams status update ${state.name} --phase implementing --message "wired command path" --progress 40 --todo <todo-id>
letta-teams status update ${state.name} --phase testing --message "running regression suite" --tests "npm test" --progress 80 --todo <todo-id>
letta-teams status checkin ${state.name} --message "still running migration pass"
\`\`\`

### Coordination contract

- Use message for one-to-one dependencies.
- Use broadcast only for changes relevant to multiple teammates.
- Include acceptance criteria in dependency requests.
- Never stay blocked silently.

### Completion contract

Final response format:

\`\`\`
OUTCOME: done|partial|blocked
CHANGES:
- <files>

VALIDATION:
- <command> (pass|fail|skipped)

RISKS:
- <0-3 bullets>

NEXT:
- <single concrete next action>
\`\`\`
`,
  );

  writeMemoryFile(
    state.agentId,
    "system/teammate/playbooks.md",
    `${renderFrontmatter("Reusable execution playbooks for teammate workflows.")}

## Execution loop playbook

1. Clarify target output and acceptance criteria.
2. Add TODO item(s) for concrete ownership.
3. Start active TODO and emit STATUS implementing.
4. Implement in minimal scoped changes.
5. Validate with project commands.
6. Mark TODO done and emit STATUS done.
7. Return structured completion contract.

## Blocker playbook

When blocked:

1. TODO -> blocked with precise dependency.
2. STATUS -> blocked with concise reason.
3. Message owner with exact ask + acceptance criteria.
4. If cross-team impact exists, broadcast impact summary.
5. Resume immediately after unblock and emit status update.

## Dependency request template

Use this structure when messaging teammates:

- Need: <single explicit dependency>
- Context: <what this unblocks>
- Acceptance: <what counts as done>
- Urgency: <now|soon|can wait>

## Review/verification playbook

Before claiming done:

- Confirm file-level changes match requested scope.
- Confirm lint/type/test outcomes are reported.
- Confirm no unrelated refactors slipped in.
- Confirm risks are explicitly listed if any remain.
`,
  );

  writeMemoryFile(
    state.agentId,
    "system/teammate/quality-bar.md",
    `${renderFrontmatter("Durable engineering quality standards for this teammate.")}

## Engineering quality bar

- Read before edit.
- Match existing architecture and style.
- Keep implementations narrow and task-focused.
- Prefer practical fixes over speculative abstractions.

## Validation quality bar

Default validation sequence:

1. lint/type checks
2. tests
3. targeted smoke checks

If validation is skipped, report exactly what is unverified and why.

## Communication quality bar

- Keep status updates compact and factual.
- Keep completion output structured and parseable.
- Never imply completion when blockers remain.

## Anti-pattern guardrail

Avoid:

- silent execution with no status
- stale TODO lifecycle state
- vague blocker reporting
- unrelated code changes
- verbose narrative without actionable summary
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

  const initConversationId = state.initConversationId || getMemoryConversationId(state.name);

  writeMemoryFile(
    state.agentId,
    "system/init/status.md",
    `${renderFrontmatter("Initialization lifecycle status for this teammate.")}

## Initialization
- Status: ${state.initStatus || "pending"}
- Init task ID: ${state.initTaskId || "pending"}
- Init conversation ID: ${initConversationId || "none"}
- Init started at: ${state.initStartedAt || "not started"}
- Init completed at: ${state.initCompletedAt || "not completed"}
- Selected specialization ID: ${state.selectedSpecId || "none"}
- Selected specialization: ${state.selectedSpecTitle || "none"}
- Init error: ${state.initError || "none"}
`,
  );
}