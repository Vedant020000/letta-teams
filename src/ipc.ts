/**
 * IPC client module - CLI communication with the daemon
 *
 * Provides functions to:
 * - Check if daemon is running
 * - Start daemon if not running
 * - Send dispatch/status commands to daemon
 * - Wait for task completion
 */

import * as net from "node:net";
import * as fs from "node:fs";
import * as child_process from "node:child_process";
import * as path from "node:path";
import { getDaemonPidPath, getDaemonPortPath, getDaemonPort } from "./daemon.js";
import { getTask, getGlobalAuthDir, ensureGlobalAuthDir, setProjectDir } from "./store.js";
import { checkApiKey } from "./agent.js";
import type { DaemonMessage, DaemonResponse, TaskState, TeammateState } from "./types.js";

// ═══════════════════════════════════════════════════════════════
// DAEMON STATUS CHECKS
// ═══════════════════════════════════════════════════════════════

/**
 * Check if the daemon is running by checking PID file and process
 */
export function isDaemonRunning(): boolean {
  const pidPath = getDaemonPidPath();

  if (!fs.existsSync(pidPath)) {
    return false;
  }

  try {
    const pid = parseInt(fs.readFileSync(pidPath, "utf-8").trim(), 10);

    if (isNaN(pid)) {
      return false;
    }

    // Check if process is running
    // On Windows, process.kill(pid, 0) throws if process doesn't exist
    // On Unix, it returns 0 if process exists
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      // Process doesn't exist, clean up stale PID file
      fs.unlinkSync(pidPath);
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Wait for daemon to be ready (socket accepting connections)
 */
export async function waitForDaemon(timeoutMs: number = 10000): Promise<boolean> {
  const startTime = Date.now();
  const port = getDaemonPort();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const connected = await new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        let resolved = false;

        const cleanup = () => {
          clearTimeout(timeoutId);
          socket.destroy();
        };

        socket.connect(port, "127.0.0.1", () => {
          if (resolved) return;
          resolved = true;
          cleanup();
          resolve(true);
        });

        socket.on("error", () => {
          if (resolved) return;
          resolved = true;
          cleanup();
          resolve(false);
        });

        // Quick timeout for connection attempt
        const timeoutId = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          cleanup();
          resolve(false);
        }, 500);
      });

      if (connected) {
        return true;
      }
    } catch {
      // Continue waiting
    }

    // Wait a bit before retrying
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════
// DAEMON STARTUP
// ═══════════════════════════════════════════════════════════════

/**
 * Get the path to the daemon log file
 */
export function getDaemonLogPath(): string {
  return path.join(getGlobalAuthDir(), "daemon.log");
}

/**
 * Start the daemon in the background
 * Uses spawn() with detached: true and redirects output to log file
 */
export function startDaemonInBackground(): number | null {
  // Ensure log directory exists
  ensureGlobalAuthDir();

  // Get path to cli.js (same directory as this ipc.js file)
  const currentDir = path.dirname(
    // On Windows, URL.pathname has a leading slash that needs to be removed
    process.platform === "win32"
      ? new URL(import.meta.url).pathname.slice(1)
      : new URL(import.meta.url).pathname
  );
  const daemonPath = path.join(currentDir, "cli.js");
  const logPath = getDaemonLogPath();

  // Open log file for daemon output
  const logFile = fs.openSync(logPath, "a");

  // Windows CREATE_NO_WINDOW flag to prevent new console window from spawning
  // This is a Windows-specific constant that must be passed directly to spawn
  const CREATE_NO_WINDOW = 0x08000000;

  // Spawn daemon as detached process with output to log file
  const child = child_process.spawn(
    process.execPath,
    [daemonPath, "daemon", "--internal"],
    {
      detached: true,
      stdio: ["ignore", logFile, logFile], // stdin: ignore, stdout: log, stderr: log
      windowsHide: true,
      ...(process.platform === "win32" && { CREATE_NO_WINDOW }),
      cwd: process.cwd(),
      env: process.env,
    }
  );

  // Let parent exit without waiting for child
  child.unref();

  return child.pid ?? null;
}

/**
 * Start the daemon and wait for it to be ready
 */
export async function startDaemon(): Promise<boolean> {
  const pid = startDaemonInBackground();

  if (!pid) {
    return false;
  }

  // Wait for daemon to be ready
  return waitForDaemon();
}

/**
 * Ensure daemon is running, starting it if necessary
 */
export async function ensureDaemonRunning(): Promise<void> {
  if (isDaemonRunning()) {
    return;
  }

  // Check API key before spawning daemon (fail fast with clear error)
  checkApiKey();

  console.log("Starting daemon...");

  const started = await startDaemon();

  if (!started) {
    throw new Error("Failed to start daemon");
  }

  console.log("Daemon started.");
}

// ═══════════════════════════════════════════════════════════════
// IPC COMMUNICATION
// ═══════════════════════════════════════════════════════════════

/**
 * Send a message to the daemon and get the response
 */
export async function sendToDaemon(
  msg: DaemonMessage,
  options?: { timeoutMs?: number }
): Promise<DaemonResponse> {
  const timeoutMs = options?.timeoutMs ?? 30000; // 30 second default
  const port = getDaemonPort();

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = "";
    let resolved = false;

    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.destroy();
    };

    socket.connect(port, "127.0.0.1", () => {
      socket.write(JSON.stringify(msg) + "\n");
    });

    socket.on("data", (data) => {
      buffer += data.toString();

      // Check if we have a complete message (ends with newline)
      if (buffer.includes("\n")) {
        if (resolved) return;
        resolved = true;
        try {
          const response: DaemonResponse = JSON.parse(buffer.trim());
          cleanup();
          resolve(response);
        } catch (error) {
          cleanup();
          reject(new Error("Invalid response from daemon"));
        }
      }
    });

    socket.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(new Error(`Failed to connect to daemon: ${err.message}`));
    });

    socket.on("close", () => {
      if (resolved) return;
      if (buffer) {
        try {
          const response: DaemonResponse = JSON.parse(buffer.trim());
          resolved = true;
          cleanup();
          resolve(response);
        } catch {
          resolved = true;
          cleanup();
          reject(new Error("Connection closed without response"));
        }
      }
    });

    // Timeout
    const timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(new Error("Timeout waiting for daemon response"));
    }, timeoutMs);
  });
}

/**
 * Dispatch a task to a teammate via the daemon
 */
export async function dispatchTask(
  teammateName: string,
  message: string,
  projectDir?: string
): Promise<{ taskId: string }> {
  const response = await sendToDaemon({
    type: "dispatch",
    teammateName,
    message,
    projectDir: projectDir ?? process.cwd(),
  });

  if (response.type !== "accepted") {
    throw new Error(
      response.type === "error" ? response.message : "Unexpected response from daemon"
    );
  }

  return { taskId: response.taskId };
}

/**
 * Get task status from daemon
 */
export async function getTaskStatus(
  taskId: string,
  projectDir?: string
): Promise<TaskState | null> {
  const response = await sendToDaemon({
    type: "status",
    taskId,
    projectDir: projectDir ?? process.cwd(),
  });

  if (response.type === "task") {
    return response.task;
  }

  if (response.type === "error") {
    return null;
  }

  return null;
}

/**
 * List recent tasks from daemon
 */
export async function listTasks(projectDir?: string): Promise<TaskState[]> {
  const response = await sendToDaemon({
    type: "list",
    projectDir: projectDir ?? process.cwd(),
  });

  if (response.type === "tasks") {
    return response.tasks;
  }

  return [];
}

/**
 * Wait for a task to complete, polling for status
 */
export async function waitForTask(
  taskId: string,
  options: { pollIntervalMs?: number; timeoutMs?: number; projectDir?: string } = {}
): Promise<TaskState> {
  const { pollIntervalMs = 1000, timeoutMs = 300000, projectDir } = options; // 5 min default timeout
  const startTime = Date.now();

  // Set project directory for reading tasks.json
  if (projectDir) {
    setProjectDir(projectDir);
  }

  while (Date.now() - startTime < timeoutMs) {
    const task = getTask(taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status === "done" || task.status === "error") {
      return task;
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timeout waiting for task ${taskId}`);
}

/**
 * Dispatch a task and wait for completion
 */
export async function dispatchAndWait(
  teammateName: string,
  message: string,
  options?: { pollIntervalMs?: number; timeoutMs?: number }
): Promise<TaskState> {
  const { taskId } = await dispatchTask(teammateName, message);
  return waitForTask(taskId, options);
}

/**
 * Spawn a teammate via the daemon (blocking operation)
 * Uses createSession internally, so needs daemon to avoid CLI timeout
 */
export async function spawnTeammateViaDaemon(
  name: string,
  role: string,
  options?: {
    model?: string;
    spawnPrompt?: string;
    skipInit?: boolean;
    memfsEnabled?: boolean;
    memfsStartup?: import("./types.js").MemfsStartup;
    timeoutMs?: number;
    projectDir?: string;
  }
): Promise<TeammateState> {
  const response = await sendToDaemon(
    {
      type: "spawn",
      name,
      role,
      model: options?.model,
      spawnPrompt: options?.spawnPrompt,
      skipInit: options?.skipInit,
      memfsEnabled: options?.memfsEnabled,
      memfsStartup: options?.memfsStartup,
      projectDir: options?.projectDir ?? process.cwd(),
    },
    { timeoutMs: options?.timeoutMs ?? 120000 } // 2 min default for spawn
  );

  if (response.type === "spawned") {
    return response.teammate;
  }

  throw new Error(
    response.type === "error" ? response.message : "Unexpected response from daemon"
  );
}

export async function reinitTeammateViaDaemon(
  teammateName: string,
  options?: {
    prompt?: string;
    timeoutMs?: number;
    projectDir?: string;
  }
): Promise<string> {
  const response = await sendToDaemon(
    {
      type: "reinit",
      teammateName,
      prompt: options?.prompt,
      projectDir: options?.projectDir ?? process.cwd(),
    },
    { timeoutMs: options?.timeoutMs ?? 30000 },
  );

  if (response.type === "accepted") {
    return response.taskId;
  }

  throw new Error(
    response.type === "error" ? response.message : "Unexpected response from daemon"
  );
}
