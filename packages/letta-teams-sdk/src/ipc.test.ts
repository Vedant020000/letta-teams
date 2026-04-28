import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Mock daemon module before importing ipc
vi.mock("./daemon.js", async () => {
  const actual = await vi.importActual("./daemon.js");
  return {
    ...actual,
    getDaemonPort: vi.fn(() => 9774),
    getDaemonPidPath: vi.fn(() => "/tmp/.lteams/daemon.pid"),
    getDaemonPortPath: vi.fn(() => "/tmp/.lteams/daemon.port"),
  };
});

// Mock store module
vi.mock("./store.js", () => ({
  getTask: vi.fn().mockReturnValue({
    id: "task-123",
    teammateName: "test-agent",
    message: "Test message",
    status: "done",
    result: "Task completed",
    createdAt: new Date().toISOString(),
  }),
  getGlobalAuthDir: vi.fn(() => "/tmp/.lteams"),
  ensureGlobalAuthDir: vi.fn(),
  setProjectDir: vi.fn(),
}));

// Mock agent module
vi.mock("./agent.js", () => ({
  checkApiKey: vi.fn(),
}));

import {
  isDaemonRunning,
  waitForDaemon,
  sendToDaemon,
  dispatchTask,
  getTaskStatus,
  listTasks,
  getDaemonLogPath,
  reinitTeammateViaDaemon,
  killTeammateViaDaemon,
  startCouncilViaDaemon,
} from "./ipc.js";
import { getDaemonPort } from "./daemon.js";

describe("IPC Module", () => {
  let tempDir: string;
  let mockServer: net.Server | null = null;
  const testPort = 19986;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "letta-teams-test-"));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (mockServer) {
      await new Promise<void>((resolve) => {
        mockServer!.close(() => resolve());
      });
      mockServer = null;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ═══════════════════════════════════════════════════════════════
  // WAIT FOR DAEMON TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("waitForDaemon", () => {
    it("should return true when daemon is available", async () => {
      // Start mock server
      await new Promise<void>((resolve) => {
        mockServer = net.createServer(() => {});
        mockServer!.listen(testPort, "127.0.0.1", resolve);
      });

      // Mock getDaemonPort to return test port
      vi.mocked(getDaemonPort).mockReturnValue(testPort);

      const result = await waitForDaemon(5000);
      expect(result).toBe(true);
    });

    it("should return false when timeout exceeded", async () => {
      // Mock getDaemonPort to return a non-listening port
      vi.mocked(getDaemonPort).mockReturnValue(19999);

      const result = await waitForDaemon(100);
      expect(result).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SEND TO DAEMON TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("sendToDaemon", () => {
    beforeEach(async () => {
      await new Promise<void>((resolve) => {
        mockServer = net.createServer((socket) => {
          let buffer = "";
          socket.on("data", (data) => {
            buffer += data.toString();
            if (buffer.includes("\n")) {
              const msg = JSON.parse(buffer.trim());

              switch (msg.type) {
                case "dispatch":
                  socket.write(JSON.stringify({ type: "accepted", taskId: "task-123" }) + "\n");
                  break;
                case "status":
                  if (msg.taskId) {
                    socket.write(JSON.stringify({
                      type: "task",
                      task: {
                        id: msg.taskId,
                        teammateName: "test",
                        message: "test",
                        status: "done",
                        createdAt: new Date().toISOString(),
                      },
                    }) + "\n");
                  } else {
                    socket.write(JSON.stringify({ type: "tasks", tasks: [] }) + "\n");
                  }
                  break;
                case "list":
                  socket.write(JSON.stringify({ type: "tasks", tasks: [] }) + "\n");
                  break;
                case "spawn":
                  socket.write(JSON.stringify({
                    type: "spawned",
                    teammate: {
                      name: msg.name,
                      role: msg.role,
                      model: msg.model,
                      agentId: "agent-123",
                      status: "idle",
                      lastUpdated: new Date().toISOString(),
                      createdAt: new Date().toISOString(),
                    },
                  }) + "\n");
                  break;
                case "reinit":
                  socket.write(JSON.stringify({ type: "accepted", taskId: "task-reinit-123" }) + "\n");
                  break;
                case "kill":
                  socket.write(JSON.stringify({ type: "killed", name: msg.name, cancelled: 2 }) + "\n");
                  break;
                case "council_start":
                  socket.write(JSON.stringify({ type: "council_started", sessionId: "council-abc" }) + "\n");
                  break;
                default:
                  socket.write(JSON.stringify({ type: "error", message: "Unknown type" }) + "\n");
              }
            }
          });
        });
        mockServer!.listen(testPort, "127.0.0.1", resolve);
      });

      // Mock getDaemonPort to return test port
      vi.mocked(getDaemonPort).mockReturnValue(testPort);
    });

    it("should send dispatch message and receive response", async () => {
      const response = await sendToDaemon(
        {
          type: "dispatch",
          teammateName: "alice",
          message: "Hello",
          projectDir: "/project",
        },
        { timeoutMs: 5000 }
      );

      expect(response.type).toBe("accepted");
      expect((response as any).taskId).toBe("task-123");
    });

    it("should send status message and receive task response", async () => {
      const response = await sendToDaemon(
        {
          type: "status",
          taskId: "task-123",
          projectDir: "/project",
        },
        { timeoutMs: 5000 }
      );

      expect(response.type).toBe("task");
      expect((response as any).task.id).toBe("task-123");
    });

    it("should send status message without taskId and receive tasks", async () => {
      const response = await sendToDaemon(
        {
          type: "status",
          projectDir: "/project",
        },
        { timeoutMs: 5000 }
      );

      expect(response.type).toBe("tasks");
    });

    it("should send list message and receive tasks", async () => {
      const response = await sendToDaemon(
        {
          type: "list",
          projectDir: "/project",
        },
        { timeoutMs: 5000 }
      );

      expect(response.type).toBe("tasks");
    });

    it("should send spawn message with Gemini model", async () => {
      const response = await sendToDaemon(
        {
          type: "spawn",
          name: "gemini-agent",
          role: "Fast responder",
          model: "google_ai/gemini-2.5-flash",
          projectDir: "/project",
        },
        { timeoutMs: 5000 }
      );

      expect(response.type).toBe("spawned");
      expect((response as any).teammate.model).toBe("google_ai/gemini-2.5-flash");
    });

    it("should send spawn message with GLM model", async () => {
      const response = await sendToDaemon(
        {
          type: "spawn",
          name: "glm-agent",
          role: "Chinese specialist",
          model: "zai/glm-5",
          projectDir: "/project",
        },
        { timeoutMs: 5000 }
      );

      expect(response.type).toBe("spawned");
      expect((response as any).teammate.model).toBe("zai/glm-5");
    });

    it("should send reinit message and receive accepted response", async () => {
      const taskId = await reinitTeammateViaDaemon("alice", {
        prompt: "Refresh your memory organization",
        projectDir: "/project",
      });

      expect(taskId).toBe("task-reinit-123");
    });

    it("should send kill message and receive killed response", async () => {
      const result = await killTeammateViaDaemon("alice", { projectDir: "/project" });
      expect(result.name).toBe("alice");
      expect(result.cancelled).toBe(2);
    });

    it("should send council_start and receive council_started", async () => {
      const result = await startCouncilViaDaemon('Build council plan', {
        message: 'Do thesis antithesis debate',
        participantNames: ['alice', 'bob'],
        maxTurns: 5,
        projectDir: '/project',
      });
      expect(result.sessionId).toBe('council-abc');
    });

    it("should timeout on slow response", async () => {
      // Create a slow server
      await new Promise<void>((resolve) => {
        mockServer!.close(() => {
          mockServer = net.createServer((socket) => {
            socket.on("data", () => {
              // Never respond
            });
          });
          mockServer!.listen(testPort, "127.0.0.1", resolve);
        });
      });

      await expect(
        sendToDaemon(
          { type: "dispatch", teammateName: "test", message: "test", projectDir: "/" },
          { timeoutMs: 100 }
        )
      ).rejects.toThrow("Timeout");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // DISPATCH TASK TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("dispatchTask", () => {
    beforeEach(async () => {
      await new Promise<void>((resolve) => {
        mockServer = net.createServer((socket) => {
          let buffer = "";
          socket.on("data", (data) => {
            buffer += data.toString();
            if (buffer.includes("\n")) {
              socket.write(JSON.stringify({ type: "accepted", taskId: "task-456" }) + "\n");
            }
          });
        });
        mockServer!.listen(testPort, "127.0.0.1", resolve);
      });

      vi.mocked(getDaemonPort).mockReturnValue(testPort);
    });

    it("should dispatch task and return taskId", async () => {
      const result = await dispatchTask("alice", "Hello");
      expect(result.taskId).toBe("task-456");
    });

    it("should throw on error response", async () => {
      await new Promise<void>((resolve) => {
        mockServer!.close(() => {
          mockServer = net.createServer((socket) => {
            let buffer = "";
            socket.on("data", (data) => {
              buffer += data.toString();
              if (buffer.includes("\n")) {
                socket.write(JSON.stringify({ type: "error", message: "Something went wrong" }) + "\n");
              }
            });
          });
          mockServer!.listen(testPort, "127.0.0.1", resolve);
        });
      });

      await expect(dispatchTask("alice", "Hello")).rejects.toThrow("Something went wrong");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // GET TASK STATUS TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("getTaskStatus", () => {
    beforeEach(async () => {
      await new Promise<void>((resolve) => {
        mockServer = net.createServer((socket) => {
          let buffer = "";
          socket.on("data", (data) => {
            buffer += data.toString();
            if (buffer.includes("\n")) {
              const msg = JSON.parse(buffer.trim());
              socket.write(JSON.stringify({
                type: "task",
                task: {
                  id: msg.taskId,
                  teammateName: "test",
                  message: "test",
                  status: "done",
                  result: "Completed",
                  createdAt: new Date().toISOString(),
                },
              }) + "\n");
            }
          });
        });
        mockServer!.listen(testPort, "127.0.0.1", resolve);
      });

      vi.mocked(getDaemonPort).mockReturnValue(testPort);
    });

    it("should get task status", async () => {
      const task = await getTaskStatus("task-123");

      expect(task).not.toBeNull();
      expect(task?.id).toBe("task-123");
      expect(task?.status).toBe("done");
    });

    it("should return null on error response", async () => {
      await new Promise<void>((resolve) => {
        mockServer!.close(() => {
          mockServer = net.createServer((socket) => {
            let buffer = "";
            socket.on("data", (data) => {
              buffer += data.toString();
              if (buffer.includes("\n")) {
                socket.write(JSON.stringify({ type: "error", message: "Not found" }) + "\n");
              }
            });
          });
          mockServer!.listen(testPort, "127.0.0.1", resolve);
        });
      });

      const task = await getTaskStatus("nonexistent");
      expect(task).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // LIST TASKS TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("listTasks", () => {
    beforeEach(async () => {
      await new Promise<void>((resolve) => {
        mockServer = net.createServer((socket) => {
          let buffer = "";
          socket.on("data", (data) => {
            buffer += data.toString();
            if (buffer.includes("\n")) {
              socket.write(JSON.stringify({
                type: "tasks",
                tasks: [
                  { id: "task-1", status: "done" },
                  { id: "task-2", status: "pending" },
                ],
              }) + "\n");
            }
          });
        });
        mockServer!.listen(testPort, "127.0.0.1", resolve);
      });

      vi.mocked(getDaemonPort).mockReturnValue(testPort);
    });

    it("should list tasks", async () => {
      const tasks = await listTasks();

      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe("task-1");
      expect(tasks[1].id).toBe("task-2");
    });

    it("should return empty array on error", async () => {
      await new Promise<void>((resolve) => {
        mockServer!.close(() => {
          mockServer = net.createServer((socket) => {
            let buffer = "";
            socket.on("data", (data) => {
              buffer += data.toString();
              if (buffer.includes("\n")) {
                socket.write(JSON.stringify({ type: "error", message: "Error" }) + "\n");
              }
            });
          });
          mockServer!.listen(testPort, "127.0.0.1", resolve);
        });
      });

      const tasks = await listTasks();
      expect(tasks).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // GET DAEMON LOG PATH TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("getDaemonLogPath", () => {
    it("should return daemon log path", () => {
      const logPath = getDaemonLogPath();
      expect(logPath).toContain("daemon.log");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // ERROR HANDLING TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Error Handling", () => {
    it("should handle connection refused", async () => {
      vi.mocked(getDaemonPort).mockReturnValue(19999);

      await expect(
        sendToDaemon(
          { type: "dispatch", teammateName: "test", message: "test", projectDir: "/" },
          { timeoutMs: 100 }
        )
      ).rejects.toThrow();
    });
  });
});
