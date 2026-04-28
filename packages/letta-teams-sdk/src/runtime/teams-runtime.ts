import { checkApiKey } from "./agent-core.js";
import { getDaemonPort, startDaemon as runDaemonServer, stopDaemon } from "./daemon-server.js";
import {
  dispatchTask,
  ensureDaemonRunning,
  forkTeammateViaDaemon,
  getDaemonLogPath,
  isDaemonRunning,
  reinitTeammateViaDaemon,
  spawnTeammateViaDaemon,
  startDaemonInBackground,
  waitForDaemon,
  waitForTask,
} from "./ipc-client.js";
import {
  getTask,
  updateTask,
} from "../store.js";
import type { MemfsStartup, TaskState, TaskStatus, TeammateState } from "../types.js";
import { createFilesystemTeamsStore } from "../storage/filesystem-store.js";
import type { TeamsStore } from "../storage/types.js";
import { TeamsError } from "./errors.js";

export interface SpawnTeammateInput {
  name: string;
  role: string;
  model?: string;
  contextWindowLimit?: number;
  spawnPrompt?: string;
  skipInit?: boolean;
  memfsEnabled?: boolean;
  memfsStartup?: MemfsStartup;
}

export interface DispatchTaskInput {
  target: string;
  message: string;
  options?: {
    pipelineId?: string;
    review?: {
      reviewer: string;
      gate: "on_success" | "always";
      template?: string;
      assignments: { name: string; message: string }[];
    };
  };
}

export interface TeamsRuntime {
  store: TeamsStore;
  daemon: {
    runInternal(port?: number): Promise<void>;
    stop(): Promise<boolean>;
    ensureRunning(): Promise<void>;
    isRunning(): boolean;
    getStatus(): { running: boolean; port: number };
    startInBackground(): Promise<{ started: boolean; pid: number; port: number }>;
    getLogPath(): string;
  };
  teammates: {
    exists(name: string): Promise<boolean>;
    targetExists(name: string): Promise<boolean>;
    list(): Promise<TeammateState[]>;
    get(name: string): Promise<TeammateState | null>;
    remove(name: string): Promise<boolean>;
    spawn(input: SpawnTeammateInput): Promise<TeammateState>;
    reinit(name: string, options?: { prompt?: string }): Promise<string>;
    fork(name: string, forkName: string): Promise<TeammateState>;
  };
  tasks: {
    get(id: string): Promise<TaskState | null>;
    list(status?: TaskStatus): Promise<TaskState[]>;
    wait(id: string): Promise<TaskState>;
    dispatch(input: DispatchTaskInput): Promise<{ taskId: string }>;
    cancel(id: string): Promise<TaskState>;
  };
}

function createRuntime(store: TeamsStore): TeamsRuntime {
  return {
    store,
    daemon: {
      async runInternal(port: number = 9774): Promise<void> {
        await runDaemonServer(port);
      },
      async stop(): Promise<boolean> {
        return stopDaemon();
      },
      async ensureRunning(): Promise<void> {
        await ensureDaemonRunning();
      },
      isRunning(): boolean {
        return isDaemonRunning();
      },
      getStatus(): { running: boolean; port: number } {
        return { running: isDaemonRunning(), port: getDaemonPort() };
      },
      async startInBackground(): Promise<{ started: boolean; pid: number; port: number }> {
        if (isDaemonRunning()) {
          return { started: false, pid: 0, port: getDaemonPort() };
        }

        try {
          checkApiKey();
        } catch (error) {
          throw new TeamsError("API_KEY_MISSING", error instanceof Error ? error.message : String(error), { cause: error });
        }

        const pid = startDaemonInBackground();
        if (!pid) {
          throw new TeamsError("DAEMON_START_FAILED", "Failed to spawn daemon process");
        }

        const ready = await waitForDaemon(10000);
        if (!ready) {
          throw new TeamsError(
            "DAEMON_START_FAILED",
            `Daemon failed to start. Check log file: ${getDaemonLogPath()}`,
          );
        }

        return { started: true, pid, port: getDaemonPort() };
      },
      getLogPath(): string {
        return getDaemonLogPath();
      },
    },
    teammates: {
      async exists(name: string): Promise<boolean> {
        return store.teammateExists(name);
      },
      async targetExists(name: string): Promise<boolean> {
        return store.targetExists(name);
      },
      async list(): Promise<TeammateState[]> {
        return store.listTeammates();
      },
      async get(name: string): Promise<TeammateState | null> {
        return store.loadTeammate(name);
      },
      async remove(name: string): Promise<boolean> {
        return store.removeTeammate(name);
      },
      async spawn(input: SpawnTeammateInput): Promise<TeammateState> {
        await ensureDaemonRunning();
        return spawnTeammateViaDaemon(input.name, input.role, {
          model: input.model,
          contextWindowLimit: input.contextWindowLimit,
          spawnPrompt: input.spawnPrompt,
          skipInit: input.skipInit,
          memfsEnabled: input.memfsEnabled,
          memfsStartup: input.memfsStartup,
        });
      },
      async reinit(name: string, options?: { prompt?: string }): Promise<string> {
        await ensureDaemonRunning();
        return reinitTeammateViaDaemon(name, options);
      },
      async fork(name: string, forkName: string): Promise<TeammateState> {
        await ensureDaemonRunning();
        return forkTeammateViaDaemon(name, forkName);
      },
    },
    tasks: {
      async get(id: string): Promise<TaskState | null> {
        return store.getTask(id);
      },
      async list(status?: TaskStatus): Promise<TaskState[]> {
        return store.listTasks(status);
      },
      async wait(id: string): Promise<TaskState> {
        return waitForTask(id);
      },
      async dispatch(input: DispatchTaskInput): Promise<{ taskId: string }> {
        await ensureDaemonRunning();
        return dispatchTask(input.target, input.message, input.options);
      },
      async cancel(id: string): Promise<TaskState> {
        const task = getTask(id);
        if (!task) {
          throw new TeamsError("TASK_NOT_FOUND", `Task '${id}' not found`);
        }
        if (task.status !== "pending" && task.status !== "running") {
          return task;
        }

        const cancelled = updateTask(id, {
          status: "error",
          error: "Cancelled by user",
          completedAt: new Date().toISOString(),
        });

        if (!cancelled) {
          throw new TeamsError("TASK_NOT_FOUND", `Task '${id}' not found`);
        }

        return cancelled;
      },
    },
  };
}

let runtimeSingleton: TeamsRuntime | null = null;

export function createTeamsRuntime(): TeamsRuntime {
  return createRuntime(createFilesystemTeamsStore());
}

export function getTeamsRuntime(): TeamsRuntime {
  if (!runtimeSingleton) {
    runtimeSingleton = createTeamsRuntime();
  }
  return runtimeSingleton;
}
