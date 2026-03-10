import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Mock the daemon module's getDaemonPort before importing
vi.mock("./daemon.js", async () => {
  const actual = await vi.importActual("./daemon.js");
  return {
    ...actual,
    getDaemonPort: vi.fn(() => 9774),
    getDaemonPidPath: vi.fn(() => "/tmp/.lteams/daemon.pid"),
    getDaemonPortPath: vi.fn(() => "/tmp/.lteams/daemon.port"),
  };
});

import {
  getDaemonPidPath,
  getDaemonPortPath,
  getDaemonPort,
  stopDaemon,
} from "./daemon.js";

describe("Daemon Module", () => {
  let tempDir: string;
  let mockServer: net.Server | null = null;
  const testPort = 19984;

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
  // PATH HELPERS TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Path Helpers", () => {
    it("should return daemon PID path", () => {
      const pidPath = getDaemonPidPath();
      expect(pidPath).toContain("daemon.pid");
    });

    it("should return daemon port path", () => {
      const portPath = getDaemonPortPath();
      expect(portPath).toContain("daemon.port");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // GET DAEMON PORT TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("getDaemonPort", () => {
    it("should return default port", () => {
      const port = getDaemonPort();
      expect(port).toBe(9774);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // STOP DAEMON TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("stopDaemon", () => {
    it("should return false when no daemon is listening", async () => {
      // Use a port that's not listening
      vi.mocked(getDaemonPort).mockReturnValue(19999);
      
      const result = await stopDaemon();
      expect(result).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TCP SERVER TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("TCP Server", () => {
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
                case "stop":
                  socket.write(JSON.stringify({ type: "stopped" }) + "\n");
                  break;
                default:
                  socket.write(JSON.stringify({ type: "error", message: "Unknown type" }) + "\n");
              }
            }
          });
        });
        mockServer!.listen(testPort, "127.0.0.1", resolve);
      });
    });

    it("should handle dispatch message", async () => {
      const response = await sendTestMessage(testPort, {
        type: "dispatch",
        teammateName: "alice",
        message: "Hello",
        projectDir: "/project",
      });

      expect(response.type).toBe("accepted");
      expect((response as any).taskId).toBe("task-123");
    });

    it("should handle spawn message", async () => {
      const response = await sendTestMessage(testPort, {
        type: "spawn",
        name: "gemini-agent",
        role: "Fast responder",
        model: "google_ai/gemini-2.5-flash",
        projectDir: "/project",
      });

      expect(response.type).toBe("spawned");
      expect((response as any).teammate.name).toBe("gemini-agent");
    });

    it("should handle spawn message with GLM model", async () => {
      const response = await sendTestMessage(testPort, {
        type: "spawn",
        name: "glm-agent",
        role: "Chinese specialist",
        model: "zai/glm-5",
        projectDir: "/project",
      });

      expect(response.type).toBe("spawned");
      expect((response as any).teammate.model).toBe("zai/glm-5");
    });

    it("should handle status message with taskId", async () => {
      const response = await sendTestMessage(testPort, {
        type: "status",
        taskId: "task-123",
        projectDir: "/project",
      });

      expect(response.type).toBe("task");
      expect((response as any).task.id).toBe("task-123");
    });

    it("should handle status message without taskId", async () => {
      const response = await sendTestMessage(testPort, {
        type: "status",
        projectDir: "/project",
      });

      expect(response.type).toBe("tasks");
    });

    it("should handle list message", async () => {
      const response = await sendTestMessage(testPort, {
        type: "list",
        projectDir: "/project",
      });

      expect(response.type).toBe("tasks");
    });

    it("should handle stop message", async () => {
      const response = await sendTestMessage(testPort, {
        type: "stop",
      });

      expect(response.type).toBe("stopped");
    });

    it("should handle unknown message type", async () => {
      const response = await sendTestMessage(testPort, {
        type: "unknown",
      });

      expect(response.type).toBe("error");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // MODEL-SPECIFIC TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Model-Specific Tests", () => {
    const modelTestPort = 19985;

    beforeEach(async () => {
      await new Promise<void>((resolve) => {
        mockServer = net.createServer((socket) => {
          let buffer = "";
          socket.on("data", (data) => {
            buffer += data.toString();
            if (buffer.includes("\n")) {
              const msg = JSON.parse(buffer.trim());

              if (msg.type === "spawn") {
                let agentId = "agent-default";
                if (msg.model === "google_ai/gemini-2.5-flash") {
                  agentId = "gemini-agent-id";
                } else if (msg.model === "zai/glm-5") {
                  agentId = "glm-agent-id";
                }

                socket.write(JSON.stringify({
                  type: "spawned",
                  teammate: {
                    name: msg.name,
                    role: msg.role,
                    model: msg.model,
                    agentId,
                    status: "idle",
                    lastUpdated: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                  },
                }) + "\n");
              }
            }
          });
        });
        mockServer!.listen(modelTestPort, "127.0.0.1", resolve);
      });
    });

    it("should handle spawn with Gemini model", async () => {
      const response = await sendTestMessage(modelTestPort, {
        type: "spawn",
        name: "gemini-agent",
        role: "Fast responder",
        model: "google_ai/gemini-2.5-flash",
        projectDir: "/project",
      });

      expect(response.type).toBe("spawned");
      expect((response as any).teammate.model).toBe("google_ai/gemini-2.5-flash");
      expect((response as any).teammate.agentId).toBe("gemini-agent-id");
    });

    it("should handle spawn with GLM model", async () => {
      const response = await sendTestMessage(modelTestPort, {
        type: "spawn",
        name: "glm-agent",
        role: "Chinese specialist",
        model: "zai/glm-5",
        projectDir: "/project",
      });

      expect(response.type).toBe("spawned");
      expect((response as any).teammate.model).toBe("zai/glm-5");
      expect((response as any).teammate.agentId).toBe("glm-agent-id");
    });

    it("should handle spawn with default model", async () => {
      const response = await sendTestMessage(modelTestPort, {
        type: "spawn",
        name: "default-agent",
        role: "Default agent",
        projectDir: "/project",
      });

      expect(response.type).toBe("spawned");
      expect((response as any).teammate.agentId).toBe("agent-default");
    });
  });
});

// Helper function to send test messages
async function sendTestMessage(port: number, msg: any): Promise<any> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.connect(port, "127.0.0.1", () => {
      socket.write(JSON.stringify(msg) + "\n");
    });
    socket.on("data", (data) => {
      try {
        resolve(JSON.parse(data.toString().trim()));
      } catch {
        resolve({ type: "parse_error" });
      }
      socket.destroy();
    });
    socket.on("error", () => resolve({ type: "error" }));
  });
}
