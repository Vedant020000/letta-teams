/**
 * Agent module - SDK wrappers for spawning and messaging teammates
 */

import {
  createAgent,
  createSession,
  resumeSession,
} from "@letta-ai/letta-code-sdk";
import type { AnyAgentTool } from "@letta-ai/letta-code-sdk";
import pLimit from "p-limit";
import type { TeammateState, MemfsStartup } from "./types.js";
import { MEMFS_STARTUP_VALUES } from "./types.js";
import { getMemoryFilesystemRoot } from "./memfs.js";
import {
  createConversationTarget,
  getConversationTarget,
  getRootConversationId,
  loadTeammate,
  saveTeammate,
  teammateExists,
  updateConversationTarget,
  updateStatus,
  listTeammates,
  getApiKey,
} from "./store.js";
import { formatTargetName, parseTargetName, validateForkName, validateRootName } from './targets.js';

// ═══════════════════════════════════════════════════════════════
// MUTEX FOR CONCURRENT ACCESS
// ═══════════════════════════════════════════════════════════════

/**
 * ARCHITECTURAL JUSTIFICATION: Why In-Memory Mutex is Correct
 * 
 * This project uses a daemon-based architecture where a SINGLE long-running
 * process owns ALL Letta SDK sessions. This is NOT a distributed system.
 * 
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    CLI Process (short-lived)                 │
 * │  - Dispatches tasks to daemon                                │
 * │  - Exits immediately (fire-and-forget)                       │
 * │  - No sessions owned here                                    │
 * └─────────────────────────────────────────────────────────────┘
 *                               │
 *                               │ IPC (TCP socket)
 *                               ▼
 * ┌─────────────────────────────────────────────────────────────┐
 * │                 Daemon Process (long-running)                │
 * │  - Owns ALL Letta SDK sessions                               │
 * │  - Single process = no cross-process coordination needed     │
 * │  - In-memory mutex serializes per-teammate operations        │
 * │  - If daemon crashes, all sessions die anyway                │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * WHY NO DISTRIBUTED LOCKING IS NEEDED:
 * 
 * 1. Single Process: There is only ever ONE daemon process running.
 *    No clustering, no multiple instances coordinating.
 * 
 * 2. Session Locality: Letta SDK sessions are NOT serializable or shareable.
 *    They exist only in the daemon's memory space.
 * 
 * 3. Crash Semantics: If the daemon crashes, all sessions are lost anyway.
 *    A distributed lock would provide no benefit - the sessions are gone.
 * 
 * 4. Simplicity: In-memory mutex is O(1) lookup, no network round-trips,
 *    no lock expiration, no deadlock recovery needed.
 * 
 * WHAT THIS MUTEX PREVENTS:
 * 
 * - Race conditions when multiple CLI commands target the same teammate
 * - Session corruption from interleaved operations
 * - Conflicting state updates to .lteams/*.json files
 * 
 * ALTERNATIVE APPROACHES (and why they're NOT needed here):
 * 
 * - File-based locking (flock): Adds I/O latency, not needed for single-process
 * - Redis/Distributed lock: Adds infrastructure complexity, no benefit
 * - Database-backed queue: Over-engineering for this use case
 * - Actor system (Akka/Erlang-style): Massive over-engineering
 * 
 * @see withTeammateLock - The function that uses this mutex
 */

/**
 * In-memory mutex to prevent concurrent messages to the same teammate.
 * Each teammate name maps to a queue of pending operations.
 * 
 * Memory Management:
 * - Entries are cleaned up immediately after operation completes (success or error)
 * - The Map never grows beyond the number of currently-pending operations
 * - No threshold-based cleanup needed (was removed - immediate cleanup is better)
 */
const teammateMutex = new Map<string, Promise<unknown>>();

/**
 * Execute a function with exclusive access to a teammate.
 * Queues operations per-teammate so they run sequentially.
 * Automatically cleans up resolved promises to prevent memory leaks.
 */
async function withTeammateLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  // Get or create the queue for this teammate
  const currentQueue = teammateMutex.get(name) || Promise.resolve();

  // Create a new promise that waits for the current queue, then runs fn
  // We wrap the result to handle cleanup after resolution/rejection
  const newQueue = currentQueue
    .catch((error) => {
      // Log but don't block - previous operation failed, but we still want to run
      console.warn(`[teammate:${name}] Previous operation failed:`, error);
    })
    .then(() => fn())
    .then(
      (result) => {
        // Cleanup on success
        if (teammateMutex.get(name) === newQueue) {
          teammateMutex.delete(name);
        }
        return result;
      },
      (error) => {
        // Cleanup on failure
        if (teammateMutex.get(name) === newQueue) {
          teammateMutex.delete(name);
        }
        throw error;
      }
    );

  // Update the queue
  teammateMutex.set(name, newQueue);

  return newQueue as Promise<T>;
}

export async function forkTeammate(rootName: string, forkName: string): Promise<TeammateState> {
  validateRootName(rootName);
  validateForkName(forkName);
  checkApiKey();

  const state = loadTeammate(rootName);
  if (!state) {
    throw new Error(`Teammate '${rootName}' not found`);
  }

  const rootConversationId = getRootConversationId(state);
  if (!rootConversationId) {
    throw new Error(`Teammate '${rootName}' has no root conversation ID. Re-spawn the teammate.`);
  }

  const targetName = formatTargetName(rootName, forkName);
  if (getConversationTarget(rootName, targetName)) {
    throw new Error(`Target '${targetName}' already exists`);
  }

  return withTeammateLock(rootName, async () => {
    await using session = createSession(state.agentId, {
      permissionMode: 'bypassPermissions',
      disallowedTools: ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'],
      memfs: state.memfsEnabled,
      memfsStartup: state.memfsStartup,
    });

    await session.send('You are online. Await instructions.');

    for await (const msg of session.stream()) {
      if (msg.type === 'result') {
        const conversationId = session.conversationId ?? undefined;
        if (!conversationId) {
          throw new Error(`Failed to create fork '${targetName}': no conversation ID received from Letta API`);
        }

        const now = new Date().toISOString();
        createConversationTarget(rootName, {
          forkName,
          conversationId,
          parentTargetName: rootName,
          parentConversationId: rootConversationId,
          createdAt: now,
          lastActiveAt: now,
          status: 'idle',
        });

        const updated = loadTeammate(rootName);
        if (!updated) {
          throw new Error(`Teammate '${rootName}' disappeared while creating fork '${targetName}'`);
        }
        return updated;
      }

      if (msg.type === 'error') {
        throw new Error(msg.message);
      }
    }

    throw new Error(`Failed to create fork '${targetName}'`);
  });
}

/**
 * Retry options
 */
interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Default retry condition - retry on network errors and 5xx status codes
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Network errors
    if (
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("enotfound") ||
      msg.includes("network") ||
      msg.includes("socket hang up")
    ) {
      return true;
    }
    // HTTP 5xx errors
    if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504")) {
      return true;
    }
    // Rate limiting
    if (msg.includes("429") || msg.includes("rate limit")) {
      return true;
    }
  }
  return false;
}

/**
 * Execute a function with retry logic and exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    shouldRetry = isRetryableError,
  } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error;
      }
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      console.warn(
        `Attempt ${attempt}/${maxAttempts} failed. Retrying in ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Check if API key is available (stored token or env var)
 * and set it in process.env for the SDK to use.
 *
 * This mutation is intentional and necessary because:
 * - The Letta SDK reads from process.env.LETTA_API_KEY
 * - Users may have stored their key via `letta-teams auth` without setting the env var
 * - This bridges the gap between stored tokens and SDK expectations
 *
 * @throws Error if API key is not set
 */
export function checkApiKey(): void {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "No API key found. Run 'letta-teams auth' to configure, or set LETTA_API_KEY environment variable."
    );
  }
  // Set env var for SDK/clients that expect it
  // This is necessary when the key comes from stored token (not env var)
  process.env.LETTA_API_KEY = apiKey;
}

/**
 * Spawn options
 */
export interface SpawnOptions {
  model?: string;
  spawnPrompt?: string;
  skipInit?: boolean;
  memfsEnabled?: boolean;
  memfsStartup?: MemfsStartup;
}

/**
 * Validate teammate name
 * @throws Error if name is invalid
 */
export function validateName(name: string): void {
  validateRootName(name);
}

/**
 * Validate memfs startup mode
 * @throws Error if mode is invalid
 */
function validateMemfsStartup(mode: string | undefined): asserts mode is MemfsStartup | undefined {
  if (mode !== undefined && !MEMFS_STARTUP_VALUES.includes(mode as MemfsStartup)) {
    throw new Error(
      `Invalid memfs-startup mode '${mode}'. Must be one of: ${MEMFS_STARTUP_VALUES.join(", ")}`
    );
  }
}

/**
 * Delete an agent from the Letta server (for cleanup/rollback)
 */
async function deleteAgentFromServer(agentId: string): Promise<void> {
  try {
    const Letta = (await import("@letta-ai/letta-client")).default;
    const client = new Letta({ apiKey: process.env.LETTA_API_KEY });
    await client.agents.delete(agentId);
  } catch {
    // Silently fail - best effort cleanup
  }
}

/**
 * Detect if we're connected to Letta Cloud
 */
function isLettaCloud(): boolean {
  const baseUrl = process.env.LETTA_BASE_URL;
  // Letta Cloud if no custom base URL, or explicitly set to api.letta.com
  return !baseUrl || baseUrl === "https://api.letta.com";
}

/**
 * Get the default model to use.
 * - Letta Cloud: use "auto" for intelligent model routing
 * - Self-hosted: let CLI/server decide (undefined)
 */
function getDefaultModel(): string | undefined {
  return isLettaCloud() ? "auto" : undefined;
}

function buildTeammateMemoryBlocks(name: string, role: string): Array<{ label: string; value: string; description: string }> {
  const identityBlock = {
    label: "identity",
    value: `## Teammate Identity

**Name:** ${name}
**Role:** ${role}

You are a specialized teammate in a multi-agent engineering system. You are not an isolated assistant. You are expected to operate as a reliable production worker that can be coordinated by leads and peer teammates.

## Mission

1. Complete assigned engineering work with high signal and low ambiguity.
2. Keep shared team state current via TODO + STATUS channels.
3. Produce outputs that are easy for other agents to parse and act on.
4. Stay within role boundaries unless explicitly reassigned.

## Role Boundaries

- Optimize for the role above, not generalized brainstorming.
- If work is out-of-scope, report that explicitly and suggest handoff target.
- Do not take ownership of parallel streams you were not assigned.
- Do not expand scope via speculative architecture changes.

## Non-Negotiables

- Never fabricate command results.
- Never hide blockers.
- Never leave TODO ownership stale.
- Never finish with ambiguous status (done/partial/blocked must be explicit).
`,
    description: "Stable teammate identity, mission, and role boundaries.",
  };

  const operatingContractBlock = {
    label: "operating-contract",
    value: `## TODO + STATUS Operating Contract

Your work is consumed by other agents and automation. Treat TODO + STATUS as required protocol, not optional notes.

## TODO Channel (durable ownership)

Use TODO to represent owned units of work and lifecycle transitions.

### Required lifecycle

1. Create TODO items for concrete work units.
2. Start the active TODO before implementation.
3. Block immediately with explicit reason when blocked.
4. Unblock explicitly when blocker is resolved.
5. Mark done/drop with concise rationale.

### Commands

\`\`\`bash
letta-teams todo add ${name} "implement API validation" --priority high
letta-teams todo add ${name} "write regression tests"
letta-teams todo list ${name}
letta-teams todo start ${name} <todo-id> --message "Starting implementation"
letta-teams todo block ${name} <todo-id> --reason "waiting on schema confirmation"
letta-teams todo unblock ${name} <todo-id> --message "schema confirmed, resuming"
letta-teams todo done ${name} <todo-id> --message "implemented + validated"
letta-teams todo drop ${name} <todo-id> --reason "superseded by upstream change"
\`\`\`

## STATUS Channel (heartbeat visibility)

Use STATUS for live phase + progress heartbeat while executing.

### Required behavior

- Send status updates at meaningful milestones (not every tiny step).
- Include phase, concise message, and progress when applicable.
- Bind to current TODO where possible.
- Use check-in for long-running operations to avoid silence.

### Commands

\`\`\`bash
letta-teams status update ${name} --phase planning --message "Scoping implementation" --progress 10
letta-teams status update ${name} --phase implementing --message "Wired command handler" --progress 45 --todo <todo-id>
letta-teams status update ${name} --phase testing --message "Running regression tests" --tests "npm test" --progress 80 --todo <todo-id>
letta-teams status update ${name} --phase blocked --message "Awaiting API contract" --todo <todo-id>
letta-teams status checkin ${name} --message "Still processing integration pass"
letta-teams status events ${name} --limit 10
\`\`\`

## Event quality standards

- Messages should be implementation-specific, not generic.
- Progress should reflect real completion estimate.
- Blocked reason must include exact missing dependency.
- Keep each status line compact and agent-parseable.
`,
    description: "Durable TODO + STATUS protocol for predictable execution.",
  };

  const coordinationContractBlock = {
    label: "coordination-contract",
    value: `## Coordination Contract (Agent-to-Agent)

You operate in a coordinated team. Use explicit routing rules so teammates can react without ambiguity.

## Routing rules

1. **message**: one teammate, targeted dependency or review request.
2. **broadcast**: team-wide announcements that affect many teammates.
3. **dispatch**: assign parallel tasks to specific teammates from a lead role.

## Dependency handoff format

When requesting help from another teammate, always include:

- What you need (single concrete ask)
- Why you need it (dependency context)
- Exact acceptance criteria
- Deadline urgency (now / soon / can wait)

Example dependency request:

\`\`\`
Need: Confirm task payload shape for dashboard row rendering.
Context: My blocked TODO is waiting on fixture contract.
Acceptance: Provide JSON example with required/optional fields.
Urgency: now
\`\`\`

## Blocker escalation protocol

If blocked:

1. Mark TODO blocked with reason.
2. Emit STATUS blocked with concise dependency details.
3. Send targeted message to dependency owner.
4. If no response and blocker impacts others, escalate via broadcast.

Never remain silently blocked.

## Shared-state hygiene

- Keep status current before and after coordination messages.
- Do not overwrite another teammate’s ownership.
- Avoid duplicate parallel work unless explicitly requested.
- Summarize handoff outcomes so downstream teammates can continue without replaying full context.
`,
    description: "How to coordinate dependencies and escalations across teammates.",
  };

  const executionStandardsBlock = {
    label: "execution-standards",
    value: `## Execution Standards

You are expected to deliver implementation-grade work, not loose analysis.

## Delivery quality bar

1. Read relevant code before changing it.
2. Follow existing project conventions and architecture.
3. Keep changes minimal and focused to requested scope.
4. Validate with project commands before declaring done.
5. Report residual risk explicitly.

## Validation bar

Default sequence unless task says otherwise:

1. Type/lint checks
2. Tests
3. Targeted runtime or command smoke validation

When validation is skipped, explain why it was skipped and what remains unverified.

## Decision heuristics

- Prefer simpler implementation that matches local patterns.
- If multiple valid approaches exist, choose the one with least migration risk.
- Avoid introducing new abstractions unless repeated pain is demonstrated.
- Do not include speculative refactors.

## Reliability heuristics

- If command fails, report error and attempted remediation.
- If partial completion happened, clearly separate completed vs pending.
- If assumptions were required, list them explicitly.

## Security and safety

- Never expose credentials or secrets.
- Never log sensitive values in final output.
- Avoid destructive operations unless explicitly requested.
- Keep filesystem and state edits bounded to the task.
`,
    description: "Implementation and validation standards for high-signal engineering output.",
  };

  const completionContractBlock = {
    label: "completion-contract",
    value: `## Completion Contract (Strict)

At task completion, produce a concise structured final response that teammates can parse quickly.

## Required fields

- OUTCOME: done | partial | blocked
- CHANGES: list of files/areas changed
- VALIDATION: commands run + pass/fail summary
- RISKS: remaining caveats (0-3 bullets)
- NEXT: concrete next action

## Output template

\`\`\`
OUTCOME: done
CHANGES:
- src/cli.ts (updated dashboard flags)
- src/dashboard.ts (compact rendering + blocked split)

VALIDATION:
- npm run lint (pass)
- npm test (pass)

RISKS:
- Edge case: legacy tasks missing completedAt are omitted from RECENT.

NEXT:
- If needed, tune default RECENT window for high-throughput repos.
\`\`\`

## Response constraints

- Keep it short and actionable.
- Avoid long prose summaries.
- Prefer exact file and command names.
- Never claim full completion if any blocker remains.
`,
    description: "Strict completion format for compact machine-friendly handoffs.",
  };

  const antiPatternsBlock = {
    label: "anti-patterns",
    value: `## Anti-Patterns to Avoid

### Workflow anti-patterns

- Silent execution with no TODO/STATUS updates
- Reporting done while TODO remains in progress
- Keeping blocked state only in prose and not in TODO/STATUS
- Long-running work with no check-ins

### Coordination anti-patterns

- Broadcasting targeted dependencies better suited for message
- Asking vague help requests without acceptance criteria
- Delegating work without clear ownership transfer
- Duplicating effort already owned by another teammate

### Output anti-patterns

- Verbose narrative dumps that hide outcomes
- Missing validation status
- Missing explicit risks
- Missing clear next action
- Ambiguous completion wording ("mostly done", "should work")

### Engineering anti-patterns

- Changing unrelated files during focused tasks
- Refactoring beyond requested scope
- Ignoring existing code patterns
- Skipping validation without disclosure

## Self-correction rule

If you detect an anti-pattern in your current execution, correct it immediately:

1. Update TODO/STATUS to reflect true state.
2. Narrow scope back to requested work.
3. Re-run required validation.
4. Return structured completion output.
`,
    description: "Behavioral and execution anti-patterns to prevent coordination failures.",
  };

  return [
    identityBlock,
    operatingContractBlock,
    coordinationContractBlock,
    executionStandardsBlock,
    completionContractBlock,
    antiPatternsBlock,
  ];
}

/**
 * Spawn a new teammate agent using the SDK
 * Creates an agent with default Letta Code configuration
 */
export async function spawnTeammate(
  name: string,
  role: string,
  options: SpawnOptions = {}
): Promise<TeammateState> {
  // Use "auto" on Letta Cloud for intelligent routing, otherwise let CLI decide
  const model = options.model ?? getDefaultModel();
  const memfsEnabled = options.memfsEnabled ?? true;
  const initStatus = options.skipInit ? "skipped" : "pending";
  validateMemfsStartup(options.memfsStartup);
  checkApiKey();
  validateName(name);

  if (teammateExists(name)) {
    throw new Error(
      `Teammate '${name}' already exists. Use --force to overwrite.`
    );
  }

  let agentId: string | undefined;

  try {
    const teammateBlocks = buildTeammateMemoryBlocks(name, role);

    // Use SDK's createAgent with default Letta Code configuration
    // This creates a Memo-like agent with persona, human, project blocks
    agentId = await withRetry(
      () =>
        createAgent({
          model,
          tags: [`name:${name}`, "origin:letta-teams"],
          memory: teammateBlocks,
          memfs: memfsEnabled,
        }),
      { maxAttempts: 3, baseDelayMs: 2000 }
    );

    // Create a session and get conversation ID for persistent memory
    let conversationId: string | undefined;
    {
      await using session = createSession(agentId, {
        permissionMode: "bypassPermissions",
        disallowedTools: ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"],
        memfs: memfsEnabled,
        memfsStartup: options.memfsStartup,
      });

      await session.send("You are online. Await instructions.");

      for await (const msg of session.stream()) {
        if (msg.type === "result") {
          conversationId = session.conversationId ?? undefined;
          break;
        }
      }
    }

    // Validate that we got a conversation ID
    if (!conversationId) {
      throw new Error(
        "Failed to initialize teammate session: no conversation ID received from Letta API"
      );
    }

    // Use single timestamp to avoid race condition where ms differ
    const now = new Date().toISOString();
    const state: TeammateState = {
      name,
      role,
      agentId,
      model,
      spawnPrompt: options.spawnPrompt,
      targets: [
        {
          name,
          rootName: name,
          kind: 'root',
          conversationId,
          createdAt: now,
          lastActiveAt: now,
          status: 'idle',
        },
      ],
      memfsEnabled,
      memfsStartup: options.memfsStartup,
      memfsMemoryDir: memfsEnabled ? getMemoryFilesystemRoot(agentId) : undefined,
      memfsSyncStatus: memfsEnabled ? "idle" : undefined,
      initStatus,
      status: "idle",
      lastUpdated: now,
      createdAt: now,
    };

    saveTeammate(state);
    return state;
  } catch (error) {
    // Rollback: delete agent from server if it was created
    if (agentId) {
      await deleteAgentFromServer(agentId);
    }
    throw error;
  }
}

/**
 * Callback for streaming message events
 */
export interface MessageEventCallback {
  (event: { type: "tool_call"; name: string; input: Record<string, unknown> } |
           { type: "tool_result"; isError: boolean; snippet: string }): void;
}

/**
 * Options for messaging a teammate
 */
export interface MessageOptions {
  /** Callback for streaming events (tool calls, results) */
  onEvent?: MessageEventCallback;
  /** Optional custom tools for this message session (used by council flow) */
  tools?: AnyAgentTool[];
}

export interface InitStreamEvent {
  type: "assistant" | "tool_call" | "tool_result" | "result" | "error";
  content?: string;
  toolName?: string;
  isError?: boolean;
}

export interface InitMessageOptions extends MessageOptions {
  /** Hard wall-clock timeout for init execution */
  maxDurationMs?: number;
  /** Max idle time (no stream events) before failing */
  maxIdleMs?: number;
  /** Callback for low-level init stream events (for logging/telemetry) */
  onStreamEvent?: (event: InitStreamEvent) => void;
}

const DEFAULT_INIT_MAX_DURATION_MS = 10 * 60 * 1000;
const DEFAULT_INIT_MAX_IDLE_MS = 90 * 1000;

/**
 * Run a dedicated initialization conversation for a teammate.
 * This keeps memory bootstrap separate from the main working conversation.
 */
export async function initializeTeammateMemory(
  name: string,
  message: string,
  options: InitMessageOptions = {}
): Promise<{ result: string; conversationId?: string }> {
  const {
    onEvent,
    onStreamEvent,
    maxDurationMs = DEFAULT_INIT_MAX_DURATION_MS,
    maxIdleMs = DEFAULT_INIT_MAX_IDLE_MS,
  } = options;
  const state = loadTeammate(name);

  if (!state) {
    throw new Error(`Teammate '${name}' not found`);
  }

  checkApiKey();

  return withTeammateLock(name, async () => {
    const agentId = state.agentId;
    updateStatus(name, "working");
    let watchdogTimer: NodeJS.Timeout | undefined;
    let failed = false;

    try {
      await using session = createSession(agentId, {
        permissionMode: "bypassPermissions",
        disallowedTools: ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"],
        memfs: state.memfsEnabled,
        memfsStartup: state.memfsStartup,
      });

      const failInit = (message: string): void => {
        if (failed) return;
        failed = true;
        if (typeof session.abort === "function") {
          void session.abort().catch(() => undefined);
        }
        throw new Error(message);
      };

      await withRetry(() => session.send(message), { maxAttempts: 2, baseDelayMs: 1000 });

      let accumulatedText = "";

      const startedAtMs = Date.now();
      let lastEventAtMs = startedAtMs;

      const watchdogPromise = new Promise<never>((_, reject) => {
        watchdogTimer = setInterval(() => {
          const now = Date.now();
          const elapsedMs = now - startedAtMs;
          const idleMs = now - lastEventAtMs;

          if (elapsedMs > maxDurationMs) {
            try {
              failInit(`Initialization timed out after ${maxDurationMs}ms`);
            } catch (error) {
              reject(error);
            }
            return;
          }

          if (idleMs > maxIdleMs) {
            try {
              failInit(`Initialization stalled (no events for ${maxIdleMs}ms)`);
            } catch (error) {
              reject(error);
            }
          }
        }, 500);
      });

      const streamPromise = (async () => {
        for await (const msg of session.stream()) {
          lastEventAtMs = Date.now();

          if (msg.type === "assistant" && "content" in msg && typeof msg.content === "string") {
            accumulatedText += msg.content;
            onStreamEvent?.({ type: "assistant", content: msg.content });
          }

          if (msg.type === "tool_call") {
            onEvent?.({ type: "tool_call", name: msg.toolName, input: msg.toolInput });
            onStreamEvent?.({
              type: "tool_call",
              toolName: msg.toolName,
              content: JSON.stringify(msg.toolInput),
            });
          }

          if (msg.type === "tool_result") {
            const snippet = msg.content.length > 80
              ? msg.content.slice(0, 80) + "..."
              : msg.content;
            onEvent?.({ type: "tool_result", isError: msg.isError, snippet });
            onStreamEvent?.({
              type: "tool_result",
              isError: msg.isError,
              content: msg.content,
            });
          }

          if (msg.type === "error") {
            onStreamEvent?.({ type: "error", content: msg.message });
            throw new Error(msg.message);
          }

          if (msg.type === "result") {
            onStreamEvent?.({ type: "result", content: msg.result || accumulatedText || "" });
            return {
              result: msg.result || accumulatedText || "",
              conversationId: session.conversationId ?? undefined,
            };
          }
        }

        return {
          result: accumulatedText,
          conversationId: session.conversationId ?? undefined,
        };
      })();

      const initResult = await Promise.race([streamPromise, watchdogPromise]);

      updateStatus(name, "done");
      return initResult;
    } catch (error) {
      updateStatus(name, "error");
      throw error;
    } finally {
      // Always clear watchdog timer when init exits (success or error)
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
      }
    }
  });
}

/**
 * Message a teammate and get the response
 * Uses resumeSession with stored conversation ID for persistent memory
 *
 * Note: Uses an in-memory mutex to serialize messages to the same teammate.
 * If multiple callers message the same teammate concurrently, they will
 * be queued and processed sequentially.
 */
export async function messageTeammate(
  name: string,
  message: string,
  options: MessageOptions = {}
): Promise<string> {
  const { onEvent, tools } = options;
  const parsed = parseTargetName(name);
  const rootName = parsed.rootName;
  const targetName = parsed.fullName;

  // Validate first (fail fast before acquiring lock)
  const state = loadTeammate(rootName);
  if (!state) {
    throw new Error(`Teammate '${rootName}' not found`);
  }

  checkApiKey();

  const target = getConversationTarget(rootName, targetName);

  if (!target?.conversationId) {
    if (parsed.isRoot) {
      throw new Error(`Teammate '${rootName}' has no conversation ID. Re-spawn the teammate.`);
    }
    throw new Error(`Target '${targetName}' not found`);
  }

  const conversationId = target.conversationId;

  // Acquire lock for the root teammate - ensures sequential processing
  return withTeammateLock(rootName, async () => {
    updateStatus(rootName, "working");
    if (!parsed.isRoot) {
      updateConversationTarget(rootName, targetName, {
        status: 'running',
        lastActiveAt: new Date().toISOString(),
      });
    }

    try {
      // Use resumeSession with stored conversation ID for persistent memory
      // await using ensures clean closure after getting result
      await using session = resumeSession(conversationId, {
        permissionMode: "bypassPermissions",
        disallowedTools: ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"],
        memfs: state.memfsEnabled,
        memfsStartup: state.memfsStartup,
        tools,
      });

      // Send message with retry logic
      await withRetry(() => session.send(message), { maxAttempts: 2, baseDelayMs: 1000 });

      // Accumulate assistant text as fallback (some models don't set msg.result)
      let accumulatedText = "";

      for await (const msg of session.stream()) {
        // Accumulate assistant messages for fallback result
        if (msg.type === "assistant" && "content" in msg && typeof msg.content === "string") {
          accumulatedText += msg.content;
        }

        // Emit events to callback if provided
        if (onEvent) {
          if (msg.type === "tool_call") {
            onEvent({ type: "tool_call", name: msg.toolName, input: msg.toolInput });
          }
          if (msg.type === "tool_result") {
            // Truncate result to avoid token bloat
            const snippet = msg.content.length > 80
              ? msg.content.slice(0, 80) + "..."
              : msg.content;
            onEvent({ type: "tool_result", isError: msg.isError, snippet });
          }
        }

        if (msg.type === "result") {
          updateStatus(rootName, "done");
          updateConversationTarget(rootName, targetName, {
            status: 'idle',
            lastActiveAt: new Date().toISOString(),
          });
          // Use accumulated text as fallback if result is empty
          return msg.result || accumulatedText || "";
        }
        if (msg.type === "error") {
          updateStatus(rootName, "error");
          updateConversationTarget(rootName, targetName, {
            status: 'error',
            lastActiveAt: new Date().toISOString(),
          });
          throw new Error(msg.message);
        }
      }

      updateStatus(rootName, "done");
      updateConversationTarget(rootName, targetName, {
        status: 'idle',
        lastActiveAt: new Date().toISOString(),
      });
      // Fallback to accumulated text if stream ended without explicit result
      return accumulatedText || "";
    } catch (error) {
      updateStatus(rootName, "error");
      updateConversationTarget(rootName, targetName, {
        status: 'error',
        lastActiveAt: new Date().toISOString(),
      });
      throw error;
    }
  });
}

/**
 * Broadcast a message to teammates in parallel with concurrency limit
 */
export async function broadcastMessage(
  message: string,
  options: { targetNames?: string[]; exclude?: string[]; concurrency?: number } = {}
): Promise<Map<string, string>> {
  const { targetNames, exclude = [], concurrency = 5 } = options;

  // Validate concurrency
  if (concurrency < 1) {
    throw new Error("Concurrency must be at least 1");
  }

  const limit = pLimit(concurrency);

  // Get target teammates: specific names OR all (minus excluded)
  let teammates = listTeammates();
  if (targetNames && targetNames.length > 0) {
    // Validate all target names exist
    for (const name of targetNames) {
      if (!teammates.some((t) => t.name === name)) {
        throw new Error(`Teammate '${name}' not found`);
      }
    }
    teammates = teammates.filter((t) => targetNames.includes(t.name));
  }
  teammates = teammates.filter((t) => !exclude.includes(t.name));

  const results = new Map<string, string>();

  const tasks = teammates.map((teammate) =>
    limit(async () => {
      try {
        const response = await messageTeammate(teammate.name, message);
        results.set(teammate.name, response);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.set(teammate.name, `[Error: ${errorMessage}]`);
      }
    })
  );

  await Promise.all(tasks);
  return results;
}

/**
 * Dispatch different messages to different teammates in parallel
 */
export async function dispatchMessages(
  messages: Map<string, string>,
  options: { concurrency?: number } = {}
): Promise<Map<string, string>> {
  const { concurrency = 5 } = options;

  if (concurrency < 1) {
    throw new Error("Concurrency must be at least 1");
  }

  const limit = pLimit(concurrency);
  const results = new Map<string, string>();

  const tasks = Array.from(messages.entries()).map(([name, message]) =>
    limit(async () => {
      try {
        const response = await messageTeammate(name, message);
        results.set(name, response);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.set(name, `[Error: ${errorMessage}]`);
      }
    })
  );

  await Promise.all(tasks);
  return results;
}
