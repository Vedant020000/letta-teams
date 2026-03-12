/**
 * Agent module - SDK wrappers for spawning and messaging teammates
 */

import {
  createAgent,
  createSession,
  resumeSession,
} from "@letta-ai/letta-code-sdk";
import pLimit from "p-limit";
import type { TeammateState, MemfsStartup } from "./types.js";
import { MEMFS_STARTUP_VALUES } from "./types.js";
import {
  loadTeammate,
  saveTeammate,
  teammateExists,
  updateStatus,
  listTeammates,
  getApiKey,
} from "./store.js";

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
}

/**
 * Validate teammate name
 * @throws Error if name is invalid
 */
export function validateName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new Error("Teammate name cannot be empty");
  }
  if (name.length > 64) {
    throw new Error("Teammate name must be 64 characters or less");
  }
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) {
    throw new Error("Teammate name contains invalid characters");
  }
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
  checkApiKey();
  validateName(name);

  if (teammateExists(name)) {
    throw new Error(
      `Teammate '${name}' already exists. Use --force to overwrite.`
    );
  }

  let agentId: string | undefined;

  try {
    // Create a custom memory block with teammate identity
    // This allows the agent to know its name for self-reporting progress
    const teammateBlock = {
      label: "teammate",
      value: `## Your Identity

**Name:** ${name}
**Role:** ${role}

You are part of a team of AI agents working together. Other teammates may be working on related tasks. A "lead" teammate may coordinate work across the team.

---

## Progress Reporting (IMPORTANT)

Your progress is visible to the team via the dashboard. Keep your status updated so others know what you're working on.

### When to Update

| When | Command |
|------|---------|
| Starting a new task | \`letta-teams update-progress ${name} --task "description"\` |
| Making progress | \`letta-teams update-progress ${name} --progress 50 --note "3 of 5 files"\` |
| Hit a blocker | \`letta-teams update-progress ${name} --problem "waiting for API docs"\` |
| Problem resolved | \`letta-teams update-progress ${name} --task "back to work"\` |
| Task complete | \`letta-teams update-progress ${name} --done\` |

### Task Queue Management

Add upcoming tasks to your queue:
\`\`\`
letta-teams update-progress ${name} --add-pending "implement tests"
letta-teams update-progress ${name} --add-pending "write documentation"
\`\`\`

Mark tasks complete:
\`\`\`
letta-teams update-progress ${name} --complete-task "implement tests"
\`\`\`

---

## Being a Good Teammate

1. **Communicate proactively** - Update your status when starting, progressing, or finishing work
2. **Report blockers early** - Don't wait until you're stuck; report problems as soon as you encounter them
3. **Be specific** - Use descriptive task names and detailed progress notes
4. **Stay focused** - Work on your assigned role; don't drift into others' domains
5. **Document your work** - Leave clear comments, commit messages, and documentation

---

## Your Status is Visible

The team can see your:
- Current task and progress percentage
- Any problems you've reported
- Pending and completed tasks
- Last update time

Check on teammates:
\`\`\`
letta-teams status          # Quick summary of everyone
letta-teams dashboard       # Visual dashboard
letta-teams info <name>     # Details on specific teammate
\`\`\`

---

## Example Workflow

\`\`\`bash
# 1. Start working
letta-teams update-progress ${name} --task "Building user authentication"

# 2. Add subtasks to queue
letta-teams update-progress ${name} --add-pending "Write unit tests"
letta-teams update-progress ${name} --add-pending "Add documentation"

# 3. Report progress as you go
letta-teams update-progress ${name} --progress 25 --note "JWT tokens implemented"
letta-teams update-progress ${name} --progress 50 --note "Login flow complete"

# 4. Hit a blocker? Report it!
letta-teams update-progress ${name} --problem "Need OAuth credentials from admin"

# 5. Blocker resolved, continue
letta-teams update-progress ${name} --task "Resuming auth work"

# 6. Complete tasks from queue
letta-teams update-progress ${name} --complete-task "Write unit tests"

# 7. Mark done when finished
letta-teams update-progress ${name} --done
\`\`\``,
      description: "Your identity in the letta-teams system and how to report progress",
    };

    // Use SDK's createAgent with default Letta Code configuration
    // This creates a Memo-like agent with persona, human, project blocks
    agentId = await withRetry(
      () =>
        createAgent({
          model,
          tags: [`name:${name}`, "origin:letta-teams"],
          memory: [teammateBlock],
        }),
      { maxAttempts: 3, baseDelayMs: 2000 }
    );

    // Create a session and get conversation ID for persistent memory
    let conversationId: string | undefined;
    {
      await using session = createSession(agentId, {
        permissionMode: "bypassPermissions",
        disallowedTools: ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"],
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
      conversationId,
      model,
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
  const { onEvent } = options;

  // Validate first (fail fast before acquiring lock)
  const state = loadTeammate(name);
  if (!state) {
    throw new Error(`Teammate '${name}' not found`);
  }

  checkApiKey();

  if (!state.conversationId) {
    throw new Error(`Teammate '${name}' has no conversation ID. Re-spawn the teammate.`);
  }

  // Store conversationId in a const to satisfy TypeScript's type narrowing
  const conversationId = state.conversationId;

  // Acquire lock for this teammate - ensures sequential processing
  return withTeammateLock(name, async () => {
    updateStatus(name, "working");

    try {
      // Use resumeSession with stored conversation ID for persistent memory
      // await using ensures clean closure after getting result
      await using session = resumeSession(conversationId, {
        permissionMode: "bypassPermissions",
        disallowedTools: ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"],
        memfs: state.memfsEnabled,
        memfsStartup: state.memfsStartup,
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
          updateStatus(name, "done");
          // Use accumulated text as fallback if result is empty
          return msg.result || accumulatedText || "";
        }
        if (msg.type === "error") {
          updateStatus(name, "error");
          throw new Error(msg.message);
        }
      }

      updateStatus(name, "done");
      // Fallback to accumulated text if stream ended without explicit result
      return accumulatedText || "";
    } catch (error) {
      updateStatus(name, "error");
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
