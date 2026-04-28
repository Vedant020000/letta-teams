import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./agent-core.js", () => ({
  checkApiKey: vi.fn(),
}));

vi.mock("./daemon-server.js", () => ({
  getDaemonPort: vi.fn(() => 9774),
  startDaemon: vi.fn().mockResolvedValue(undefined),
  stopDaemon: vi.fn().mockResolvedValue(true),
}));

vi.mock("./ipc-client.js", () => ({
  dispatchTask: vi.fn().mockResolvedValue({ taskId: "task-123" }),
  ensureDaemonRunning: vi.fn().mockResolvedValue(undefined),
  forkTeammateViaDaemon: vi.fn().mockResolvedValue({ name: "backend", agentId: "agent-1", role: "Backend", status: "idle", lastUpdated: new Date().toISOString(), createdAt: new Date().toISOString() }),
  getDaemonLogPath: vi.fn(() => "C:/tmp/daemon.log"),
  isDaemonRunning: vi.fn(() => false),
  reinitTeammateViaDaemon: vi.fn().mockResolvedValue("task-reinit"),
  spawnTeammateViaDaemon: vi.fn().mockResolvedValue({ name: "backend", agentId: "agent-1", role: "Backend", status: "idle", lastUpdated: new Date().toISOString(), createdAt: new Date().toISOString() }),
  startDaemonInBackground: vi.fn(() => 1234),
  waitForDaemon: vi.fn().mockResolvedValue(true),
  waitForTask: vi.fn().mockResolvedValue({ id: "task-123", teammateName: "backend", message: "work", status: "done", createdAt: new Date().toISOString() }),
}));

vi.mock("../store.js", () => ({
  getTask: vi.fn(),
  updateTask: vi.fn(),
  targetExists: vi.fn(() => true),
  teammateExists: vi.fn(() => true),
  loadTeammate: vi.fn(() => null),
  listTeammates: vi.fn(() => []),
  removeTeammate: vi.fn(() => true),
}));

describe("teams runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a runtime with daemon, teammates, and tasks APIs", async () => {
    const { createTeamsRuntime } = await import("./teams-runtime.js");

    const runtime = createTeamsRuntime();

    expect(runtime.daemon.getStatus()).toEqual({ running: false, port: 9774 });
    expect(typeof runtime.teammates.spawn).toBe("function");
    expect(typeof runtime.tasks.dispatch).toBe("function");
  });

  it("returns the same singleton runtime instance", async () => {
    const { getTeamsRuntime } = await import("./teams-runtime.js");

    const first = getTeamsRuntime();
    const second = getTeamsRuntime();

    expect(first).toBe(second);
  });

  it("starts the daemon in background through the runtime facade", async () => {
    const { createTeamsRuntime } = await import("./teams-runtime.js");

    const runtime = createTeamsRuntime();
    const result = await runtime.daemon.startInBackground();

    expect(result).toEqual({ started: true, pid: 1234, port: 9774 });
  });

  it("throws a typed error when cancelling a missing task", async () => {
    const store = await import("../store.js");
    vi.mocked(store.getTask).mockReturnValue(null);

    const { createTeamsRuntime } = await import("./teams-runtime.js");

    const runtime = createTeamsRuntime();

    await expect(runtime.tasks.cancel("missing-task")).rejects.toMatchObject({
      name: "TeamsError",
      code: "TASK_NOT_FOUND",
    });
  });
});
