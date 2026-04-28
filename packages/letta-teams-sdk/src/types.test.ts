import { describe, it, expect } from "vitest";
import {
  parseMemfsStartup,
  MEMFS_STARTUP_VALUES,
  type TeammateState,
  type TeammateStatus,
  type TodoItem,
  type StatusEvent,
  type TeammateExecutionStatus,
  type TaskState,
  type TaskStatus,
  type MemfsStartup,
  type DaemonMessage,
  type DaemonResponse,
  type ToolCallEvent,
} from "./types.js";

describe("Types Module", () => {
  // ═══════════════════════════════════════════════════════════════
  // PARSE MEMFS STARTUP TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("parseMemfsStartup", () => {
    it("should return undefined for undefined input", () => {
      expect(parseMemfsStartup(undefined)).toBeUndefined();
    });

    it("should accept 'blocking' value", () => {
      expect(parseMemfsStartup("blocking")).toBe("blocking");
    });

    it("should accept 'background' value", () => {
      expect(parseMemfsStartup("background")).toBe("background");
    });

    it("should accept 'skip' value", () => {
      expect(parseMemfsStartup("skip")).toBe("skip");
    });

    it("should reject invalid values", () => {
      expect(() => parseMemfsStartup("invalid")).toThrow(
        "Invalid memfs-startup mode 'invalid'"
      );
    });

    it("should reject empty string", () => {
      expect(() => parseMemfsStartup("")).toThrow(
        "Invalid memfs-startup mode ''"
      );
    });

    it("should reject case-sensitive mismatches", () => {
      expect(() => parseMemfsStartup("Blocking")).toThrow(
        "Invalid memfs-startup mode 'Blocking'"
      );
      expect(() => parseMemfsStartup("BLOCKING")).toThrow(
        "Invalid memfs-startup mode 'BLOCKING'"
      );
    });

    it("should include valid values in error message", () => {
      try {
        parseMemfsStartup("invalid");
      } catch (error) {
        expect((error as Error).message).toContain("blocking");
        expect((error as Error).message).toContain("background");
        expect((error as Error).message).toContain("skip");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // MEMFS STARTUP VALUES CONSTANT TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("MEMFS_STARTUP_VALUES", () => {
    it("should contain all valid modes", () => {
      expect(MEMFS_STARTUP_VALUES).toContain("blocking");
      expect(MEMFS_STARTUP_VALUES).toContain("background");
      expect(MEMFS_STARTUP_VALUES).toContain("skip");
    });

    it("should have exactly 3 values", () => {
      expect(MEMFS_STARTUP_VALUES).toHaveLength(3);
    });

    it("should be a readonly array", () => {
      // TypeScript enforces readonly at compile time
      // At runtime, we just verify it's an array
      expect(Array.isArray(MEMFS_STARTUP_VALUES)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TYPE DEFINITIONS TESTS (compile-time checks)
  // ═══════════════════════════════════════════════════════════════

  describe("Type Definitions", () => {
    it("should accept valid TeammateState", () => {
      const state: TeammateState = {
        name: "test",
        role: "Test role",
        agentId: "agent-123",
        model: "google_ai/gemini-2.5-flash",
        status: "idle",
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      
      expect(state.name).toBe("test");
    });

    it("should accept TeammateState with minimal fields", () => {
      const state: TeammateState = {
        name: "test",
        role: "Test role",
        agentId: "agent-123",
        status: "idle",
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      expect(state.targets).toBeUndefined();
    });

    it("should accept TeammateState with all optional fields", () => {
      const todoItems: TodoItem[] = [
        {
          id: "todo-1",
          title: "Building feature",
          state: "in_progress",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
        },
      ];

      const statusSummary: TeammateExecutionStatus = {
        phase: "implementing",
        message: "Halfway done",
        progress: 50,
        currentTodoId: "todo-1",
        lastHeartbeatAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const statusEvents: StatusEvent[] = [
        {
          id: "evt-1",
          ts: new Date().toISOString(),
          type: "progress",
          phase: "implementing",
          message: "Halfway done",
          todoId: "todo-1",
        },
      ];

      const state: TeammateState = {
        name: "test",
        role: "Test role",
        agentId: "agent-123",
        model: "zai/glm-5",
        memfsEnabled: true,
        memfsStartup: "blocking",
        status: "working",
        todoItems,
        statusSummary,
        statusEvents,
        errorDetails: "Error details",
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      
      expect(state.memfsEnabled).toBe(true);
      expect(state.todoItems).toHaveLength(1);
      expect(state.statusSummary?.phase).toBe("implementing");
      expect(state.statusEvents).toHaveLength(1);
    });

    it("should accept valid TeammateStatus values", () => {
      const status1: TeammateStatus = "working";
      const status2: TeammateStatus = "idle";
      const status3: TeammateStatus = "done";
      const status4: TeammateStatus = "error";
      
      expect(["working", "idle", "done", "error"]).toContain(status1);
      expect(["working", "idle", "done", "error"]).toContain(status2);
      expect(["working", "idle", "done", "error"]).toContain(status3);
      expect(["working", "idle", "done", "error"]).toContain(status4);
    });

    it("should accept valid TaskState", () => {
      const task: TaskState = {
        id: "task-123",
        teammateName: "test",
        message: "Do something",
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      
      expect(task.id).toBe("task-123");
    });

    it("should accept TaskState with all optional fields", () => {
      const task: TaskState = {
        id: "task-123",
        teammateName: "test",
        message: "Do something",
        status: "done",
        result: "Task completed",
        error: undefined,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        toolCalls: [
          { name: "Read", input: "/file.ts", success: true },
          { name: "Write", input: "/file.ts", success: false, error: "Permission denied" },
        ],
      };
      
      expect(task.toolCalls).toHaveLength(2);
    });

    it("should accept valid TaskStatus values", () => {
      const status1: TaskStatus = "pending";
      const status2: TaskStatus = "running";
      const status3: TaskStatus = "done";
      const status4: TaskStatus = "error";
      
      expect(["pending", "running", "done", "error"]).toContain(status1);
      expect(["pending", "running", "done", "error"]).toContain(status2);
      expect(["pending", "running", "done", "error"]).toContain(status3);
      expect(["pending", "running", "done", "error"]).toContain(status4);
    });

    it("should accept valid MemfsStartup values", () => {
      const mode1: MemfsStartup = "blocking";
      const mode2: MemfsStartup = "background";
      const mode3: MemfsStartup = "skip";
      
      expect(["blocking", "background", "skip"]).toContain(mode1);
      expect(["blocking", "background", "skip"]).toContain(mode2);
      expect(["blocking", "background", "skip"]).toContain(mode3);
    });

    it("should accept valid ToolCallEvent", () => {
      const event: ToolCallEvent = {
        name: "Read",
        input: "/path/to/file.ts",
        success: true,
      };
      
      expect(event.name).toBe("Read");
    });

    it("should accept ToolCallEvent with error", () => {
      const event: ToolCallEvent = {
        name: "Bash",
        input: "rm -rf /",
        success: false,
        error: "Permission denied",
      };
      
      expect(event.success).toBe(false);
      expect(event.error).toBe("Permission denied");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // DAEMON MESSAGE TYPES TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Daemon Message Types", () => {
    it("should accept dispatch message", () => {
      const msg: DaemonMessage = {
        type: "dispatch",
        teammateName: "alice",
        message: "Hello",
        projectDir: "/project",
      };
      
      expect(msg.type).toBe("dispatch");
    });

    it("should accept spawn message", () => {
      const msg: DaemonMessage = {
        type: "spawn",
        name: "alice",
        role: "Developer",
        model: "google_ai/gemini-2.5-flash",
        projectDir: "/project",
      };
      
      expect(msg.type).toBe("spawn");
    });

    it("should accept spawn message without model", () => {
      const msg: DaemonMessage = {
        type: "spawn",
        name: "alice",
        role: "Developer",
        projectDir: "/project",
      };
      
      expect(msg.type).toBe("spawn");
    });

    it("should accept status message with taskId", () => {
      const msg: DaemonMessage = {
        type: "status",
        taskId: "task-123",
        projectDir: "/project",
      };
      
      expect(msg.type).toBe("status");
    });

    it("should accept status message without taskId", () => {
      const msg: DaemonMessage = {
        type: "status",
        projectDir: "/project",
      };
      
      expect(msg.type).toBe("status");
    });

    it("should accept list message", () => {
      const msg: DaemonMessage = {
        type: "list",
        projectDir: "/project",
      };
      
      expect(msg.type).toBe("list");
    });

    it("should accept kill message", () => {
      const msg: DaemonMessage = {
        type: "kill",
        name: "alice",
        projectDir: "/project",
      };

      expect(msg.type).toBe("kill");
    });

    it("should accept council_start message", () => {
      const msg: DaemonMessage = {
        type: 'council_start',
        prompt: 'Implement X?',
        message: 'Discuss thesis/antithesis',
        participantNames: ['alice', 'bob'],
        maxTurns: 5,
        projectDir: '/project',
      };

      expect(msg.type).toBe('council_start');
    });

    it("should accept stop message", () => {
      const msg: DaemonMessage = {
        type: "stop",
      };
      
      expect(msg.type).toBe("stop");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // DAEMON RESPONSE TYPES TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Daemon Response Types", () => {
    it("should accept accepted response", () => {
      const resp: DaemonResponse = {
        type: "accepted",
        taskId: "task-123",
      };
      
      expect(resp.type).toBe("accepted");
    });

    it("should accept spawned response", () => {
      const resp: DaemonResponse = {
        type: "spawned",
        teammate: {
          name: "alice",
          role: "Developer",
          agentId: "agent-123",
          status: "idle",
          lastUpdated: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      };
      
      expect(resp.type).toBe("spawned");
    });

    it("should accept killed response", () => {
      const resp: DaemonResponse = {
        type: "killed",
        name: "alice",
        cancelled: 1,
      };

      expect(resp.type).toBe("killed");
    });

    it('should accept council_started response', () => {
      const resp: DaemonResponse = {
        type: 'council_started',
        sessionId: 'council-abc',
      };

      expect(resp.type).toBe('council_started');
    });

    it("should accept task response", () => {
      const resp: DaemonResponse = {
        type: "task",
        task: {
          id: "task-123",
          teammateName: "alice",
          message: "Hello",
          status: "done",
          createdAt: new Date().toISOString(),
        },
      };
      
      expect(resp.type).toBe("task");
    });

    it("should accept tasks response", () => {
      const resp: DaemonResponse = {
        type: "tasks",
        tasks: [],
      };
      
      expect(resp.type).toBe("tasks");
    });

    it("should accept error response", () => {
      const resp: DaemonResponse = {
        type: "error",
        message: "Something went wrong",
      };
      
      expect(resp.type).toBe("error");
    });

    it("should accept stopped response", () => {
      const resp: DaemonResponse = {
        type: "stopped",
      };
      
      expect(resp.type).toBe("stopped");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // MODEL-SPECIFIC TYPE TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Model-Specific Types", () => {
    it("should accept Gemini model in TeammateState", () => {
      const state: TeammateState = {
        name: "gemini-agent",
        role: "Fast responder",
        agentId: "agent-123",
        model: "google_ai/gemini-2.5-flash",
        status: "idle",
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      
      expect(state.model).toBe("google_ai/gemini-2.5-flash");
    });

    it("should accept GLM model in TeammateState", () => {
      const state: TeammateState = {
        name: "glm-agent",
        role: "Chinese specialist",
        agentId: "agent-456",
        model: "zai/glm-5",
        status: "idle",
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      
      expect(state.model).toBe("zai/glm-5");
    });

    it("should accept model in spawn message for Gemini", () => {
      const msg: DaemonMessage = {
        type: "spawn",
        name: "gemini-agent",
        role: "Fast responder",
        model: "google_ai/gemini-2.5-flash",
        projectDir: "/project",
      };
      
      expect(msg.type).toBe("spawn");
      if (msg.type === "spawn") {
        expect(msg.model).toBe("google_ai/gemini-2.5-flash");
      }
    });

    it("should accept model in spawn message for GLM", () => {
      const msg: DaemonMessage = {
        type: "spawn",
        name: "glm-agent",
        role: "Chinese specialist",
        model: "zai/glm-5",
        projectDir: "/project",
      };
      
      expect(msg.type).toBe("spawn");
      if (msg.type === "spawn") {
        expect(msg.model).toBe("zai/glm-5");
      }
    });
  });
});
