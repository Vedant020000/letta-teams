/**
 * Daemon module - long-running process that handles agent sessions
 *
 * The daemon owns all SDK sessions, allowing CLI commands to dispatch
 * tasks and exit immediately while the daemon continues processing.
 */

import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { messageTeammate, spawnTeammate, checkApiKey } from "./agent.js";
import {
  createTask,
  updateTask,
  getTask,
  listRecentTasks,
  loadTasks,
  saveTasks,
  getGlobalAuthDir,
  ensureGlobalAuthDir,
  setProjectDir,
} from "./store.js";
import type { DaemonMessage, DaemonResponse, TaskState, TeammateState } from "./types.js";

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const DEFAULT_PORT = 9774;
const DAEMON_PID_FILE = "daemon.pid";
const DAEMON_PORT_FILE = "daemon.port";

/**
 * Get daemon files directory (same as global auth dir)
 */
function getDaemonDir(): string {
  return getGlobalAuthDir();
}

/**
 * Get the path to the daemon PID file
 */
export function getDaemonPidPath(): string {
  return path.join(getDaemonDir(), DAEMON_PID_FILE);
}

/**
 * Get the path to the daemon port file
 */
export function getDaemonPortPath(): string {
  return path.join(getDaemonDir(), DAEMON_PORT_FILE);
}

/**
 * Get the configured port (from file or default)
 */
export function getDaemonPort(): number {
  const portPath = getDaemonPortPath();
  if (fs.existsSync(portPath)) {
    try {
      const port = parseInt(fs.readFileSync(portPath, "utf-8").trim(), 10);
      if (!isNaN(port) && port > 0 && port < 65536) {
        return port;
      }
    } catch {
      // Fall through to default
    }
  }
  return DEFAULT_PORT;
}

/**
 * Save the daemon port to file
 */
function saveDaemonPort(port: number): void {
  ensureGlobalAuthDir();
  fs.writeFileSync(getDaemonPortPath(), port.toString());
}

/**
 * Save the daemon PID to file
 */
function saveDaemonPid(): void {
  ensureGlobalAuthDir();
  fs.writeFileSync(getDaemonPidPath(), process.pid.toString());
}

/**
 * Remove the daemon PID file
 */
function removeDaemonPid(): void {
  const pidPath = getDaemonPidPath();
  if (fs.existsSync(pidPath)) {
    fs.unlinkSync(pidPath);
  }
}

// ═══════════════════════════════════════════════════════════════
// DAEMON STATE
// ═══════════════════════════════════════════════════════════════

/**
 * In-memory tracking of running tasks (for quick status checks)
 */
const runningTasks = new Map<string, { startedAt: string }>();

// ═══════════════════════════════════════════════════════════════
// DAEMON SERVER
// ═══════════════════════════════════════════════════════════════

/**
 * Handle an incoming IPC message
 */
async function handleMessage(msg: DaemonMessage): Promise<DaemonResponse> {
  switch (msg.type) {
    case "dispatch": {
      // Set project directory for finding teammate files
      setProjectDir(msg.projectDir);

      // Create task record
      const task = createTask(msg.teammateName, msg.message);

      // Start processing in background (don't await)
      processTask(task.id, msg.teammateName, msg.message).catch((error) => {
        console.error(`Task ${task.id} failed:`, error);
      });

      return { type: "accepted", taskId: task.id };
    }

    case "spawn": {
      // Set project directory for saving teammate files
      setProjectDir(msg.projectDir);

      // Spawn is a blocking operation - we wait for it to complete
      try {
        checkApiKey();
        const teammate = await spawnTeammate(msg.name, msg.role, {
          model: msg.model,
        });
        return { type: "spawned", teammate };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return { type: "error", message: errorMessage };
      }
    }

    case "status": {
      // Set project directory for finding tasks.json
      setProjectDir(msg.projectDir);

      if (msg.taskId) {
        const task = getTask(msg.taskId);
        if (!task) {
          return { type: "error", message: `Task ${msg.taskId} not found` };
        }
        return { type: "task", task };
      } else {
        // Return all recent tasks
        const tasks = listRecentTasks(50);
        return { type: "tasks", tasks };
      }
    }

    case "list": {
      // Set project directory for finding tasks.json
      setProjectDir(msg.projectDir);

      const tasks = listRecentTasks(50);
      return { type: "tasks", tasks };
    }

    case "stop": {
      // Signal graceful shutdown - give time for response to be sent
      setTimeout(() => {
        shutdown();
      }, 200);
      return { type: "stopped" };
    }

    default: {
      return { type: "error", message: "Unknown message type" };
    }
  }
}

/**
 * Process a task by messaging the teammate
 */
async function processTask(
  taskId: string,
  teammateName: string,
  message: string
): Promise<void> {
  const startedAt = new Date().toISOString();

  // Update task status
  updateTask(taskId, { status: "running", startedAt });
  runningTasks.set(taskId, { startedAt });

  // Track tool calls
  const toolCalls: { name: string; input?: string; success: boolean; error?: string }[] = [];

  try {
    // Check API key before running
    checkApiKey();

    // Run the message through the agent module with event tracking
    const result = await messageTeammate(teammateName, message, {
      onEvent: (event) => {
        if (event.type === "tool_call") {
          // Create a brief input summary
          let inputSummary: string | undefined;
          if (event.input) {
            const input = event.input as Record<string, unknown>;
            // Common patterns: file_path, command, pattern
            if (input.file_path) {
              inputSummary = String(input.file_path).split("/").pop();
            } else if (input.command) {
              inputSummary = String(input.command).slice(0, 50);
            } else if (input.pattern) {
              inputSummary = String(input.pattern);
            }
          }
          toolCalls.push({
            name: event.name,
            input: inputSummary,
            success: true, // Will be updated on tool_result
          });
        } else if (event.type === "tool_result") {
          // Update last tool call with result status
          const lastCall = toolCalls[toolCalls.length - 1];
          if (lastCall) {
            lastCall.success = !event.isError;
            if (event.isError) {
              lastCall.error = event.snippet;
            }
          }
        }
      },
    });

    // Update task with result and tool calls
    updateTask(taskId, {
      status: "done",
      result,
      completedAt: new Date().toISOString(),
      toolCalls,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    // Update task with error and tool calls
    updateTask(taskId, {
      status: "error",
      error: errorMessage,
      completedAt: new Date().toISOString(),
      toolCalls,
    });
  } finally {
    runningTasks.delete(taskId);
  }
}

/**
 * Create the TCP server
 */
function createServer(): net.Server {
  const server = net.createServer((socket) => {
    let buffer = "";

    socket.on("data", async (data) => {
      buffer += data.toString();

      // Try to parse complete JSON messages
      // Messages are newline-delimited
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const msg: DaemonMessage = JSON.parse(line);
          const response = await handleMessage(msg);
          socket.write(JSON.stringify(response) + "\n");
        } catch (error) {
          const response: DaemonResponse = {
            type: "error",
            message:
              error instanceof Error ? error.message : "Invalid message",
          };
          socket.write(JSON.stringify(response) + "\n");
        }
      }
    });

    socket.on("error", (err) => {
      // Log but don't crash
      console.error("Socket error:", err.message);
    });
  });

  return server;
}

/**
 * Shutdown the daemon gracefully
 */
function shutdown(): void {
  console.log("Daemon shutting down...");
  removeDaemonPid();
  process.exit(0);
}

/**
 * Start the daemon
 */
export async function startDaemon(port: number = DEFAULT_PORT): Promise<void> {
  // Ensure API key is available
  try {
    checkApiKey();
  } catch (error) {
    console.error(
      "Error:",
      error instanceof Error ? error.message : "No API key found"
    );
    process.exit(1);
  }

  // Save PID and port
  saveDaemonPid();
  saveDaemonPort(port);

  const server = createServer();

  // Handle shutdown signals
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Handle unexpected exits
  process.on("exit", removeDaemonPid);

  return new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => {
      console.log(`Letta Teams daemon listening on 127.0.0.1:${port}`);
      console.log(`PID: ${process.pid}`);
      console.log(`PID file: ${getDaemonPidPath()}`);
      resolve();
    });

    server.on("error", (err) => {
      // @ts-expect-error - Node.js error codes
      if (err.code === "EADDRINUSE") {
        console.error(`Port ${port} is already in use. Is another daemon running?`);
        process.exit(1);
      }
      reject(err);
    });
  });
}

/**
 * Stop a running daemon (via IPC)
 */
export async function stopDaemon(): Promise<boolean> {
  const port = getDaemonPort();

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    let buffer = "";

    const cleanup = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      socket.destroy();
      resolve(result);
    };

    socket.connect(port, "127.0.0.1", () => {
      const msg: DaemonMessage = { type: "stop" };
      socket.write(JSON.stringify(msg) + "\n");
    });

    socket.on("data", (data) => {
      buffer += data.toString();
      // Check for complete message
      if (buffer.includes("\n")) {
        try {
          const response: DaemonResponse = JSON.parse(buffer.trim());
          cleanup(response.type === "stopped");
        } catch {
          cleanup(false);
        }
      }
    });

    socket.on("error", () => {
      cleanup(false);
    });

    socket.on("close", () => {
      // If we have data but no newline, try to parse anyway
      if (!resolved && buffer.trim()) {
        try {
          const response: DaemonResponse = JSON.parse(buffer.trim());
          cleanup(response.type === "stopped");
        } catch {
          cleanup(false);
        }
      } else if (!resolved) {
        cleanup(false);
      }
    });

    // Timeout after 5 seconds
    const timeoutId = setTimeout(() => {
      cleanup(false);
    }, 5000);
  });
}
