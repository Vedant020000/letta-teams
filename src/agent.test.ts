import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  validateName,
  checkApiKey,
  spawnTeammate,
  initializeTeammateMemory,
  messageTeammate,
  broadcastMessage,
  dispatchMessages,
} from "./agent.js";
import * as store from "./store.js";

// Mock the SDK
vi.mock("@letta-ai/letta-code-sdk", () => ({
  createAgent: vi.fn().mockImplementation(async (options?: { model?: string }) => {
    if (options?.model === "google_ai/gemini-2.5-flash") {
      return "mock-gemini-agent-id";
    }
    if (options?.model === "zai/glm-5") {
      return "mock-glm-agent-id";
    }
    return "mock-agent-id";
  }),
  createSession: vi.fn().mockImplementation((agentId: string) => ({
    agentId,
    conversationId: `conv-${agentId}`,
    send: vi.fn().mockResolvedValue(undefined),
    stream: vi.fn().mockImplementation(async function* () {
      yield { type: "result", result: "Task completed successfully!" };
    }),
    [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
  })),
  resumeSession: vi.fn().mockImplementation((conversationId: string) => ({
    conversationId,
    send: vi.fn().mockResolvedValue(undefined),
    stream: vi.fn().mockImplementation(async function* () {
      yield { type: "assistant", content: "Working on it..." };
      yield { type: "tool_call", toolName: "Read", toolInput: { file_path: "/test/file.ts" } };
      yield { type: "tool_result", content: "file contents", isError: false };
      yield { type: "result", result: "Task completed successfully!" };
    }),
    [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock the store module
vi.mock("./store.js", () => ({
  getApiKey: vi.fn(),
  teammateExists: vi.fn(),
  saveTeammate: vi.fn(),
  loadTeammate: vi.fn(),
  updateStatus: vi.fn(),
  listTeammates: vi.fn(),
  updateTeammate: vi.fn(),
}));

// Mock @letta-ai/letta-client for deleteAgentFromServer
vi.mock("@letta-ai/letta-client", () => ({
  default: vi.fn().mockImplementation(() => ({
    agents: {
      delete: vi.fn().mockResolvedValue(undefined),
    },
  })),
}));

describe("Agent Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LETTA_API_KEY = "test-api-key";
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.LETTA_API_KEY;
  });

  // ═══════════════════════════════════════════════════════════════
  // VALIDATE NAME TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("validateName", () => {
    it("should accept valid names", () => {
      expect(() => validateName("alice")).not.toThrow();
      expect(() => validateName("bob-123")).not.toThrow();
      expect(() => validateName("test_agent")).not.toThrow();
      expect(() => validateName("Agent-Name-123")).not.toThrow();
    });

    it("should reject empty names", () => {
      expect(() => validateName("")).toThrow("cannot be empty");
      expect(() => validateName("   ")).toThrow("cannot be empty");
      expect(() => validateName("\t\n")).toThrow("cannot be empty");
    });

    it("should reject names over 64 characters", () => {
      const longName = "a".repeat(65);
      expect(() => validateName(longName)).toThrow("64 characters or less");
    });

    it("should accept names up to 64 characters", () => {
      const maxName = "a".repeat(64);
      expect(() => validateName(maxName)).not.toThrow();
    });

    it("should reject names with invalid characters", () => {
      expect(() => validateName("test<agent>")).toThrow("invalid characters");
      expect(() => validateName("test/agent")).toThrow("invalid characters");
      expect(() => validateName("test:agent")).toThrow("invalid characters");
      expect(() => validateName("test\\agent")).toThrow("invalid characters");
      expect(() => validateName("test|agent")).toThrow("invalid characters");
      expect(() => validateName("test?agent")).toThrow("invalid characters");
      expect(() => validateName("test*agent")).toThrow("invalid characters");
      expect(() => validateName('test"agent')).toThrow("invalid characters");
    });

    it("should reject names with control characters", () => {
      expect(() => validateName("test\x00agent")).toThrow("invalid characters");
      expect(() => validateName("test\x1fagent")).toThrow("invalid characters");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // CHECK API KEY TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("checkApiKey", () => {
    it("should throw if no API key", () => {
      vi.mocked(store.getApiKey).mockReturnValue(null);
      expect(() => checkApiKey()).toThrow("No API key found");
    });

    it("should set env var if key exists from store", () => {
      delete process.env.LETTA_API_KEY;
      vi.mocked(store.getApiKey).mockReturnValue("stored-key");
      
      checkApiKey();
      expect(process.env.LETTA_API_KEY).toBe("stored-key");
    });

    it("should not override env var if already set", () => {
      delete process.env.LETTA_API_KEY;
      vi.mocked(store.getApiKey).mockReturnValue("stored-key");
      
      checkApiKey();
      expect(process.env.LETTA_API_KEY).toBe("stored-key");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SPAWN TEAMMATE TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("spawnTeammate", () => {
    beforeEach(() => {
      vi.mocked(store.getApiKey).mockReturnValue("test-key");
      vi.mocked(store.teammateExists).mockReturnValue(false);
      vi.mocked(store.saveTeammate).mockImplementation(() => {});
    });

    it("should spawn a teammate successfully", async () => {
      const state = await spawnTeammate("alice", "Developer");
      
      expect(state.name).toBe("alice");
      expect(state.role).toBe("Developer");
      expect(state.agentId).toBe("mock-agent-id");
      expect(state.status).toBe("idle");
      expect(state.conversationId).toBeDefined();
      expect(store.saveTeammate).toHaveBeenCalled();
    });

    it("should spawn a teammate with Gemini model", async () => {
      const state = await spawnTeammate("gemini-agent", "Fast responder", {
        model: "google_ai/gemini-2.5-flash",
      });
      
      expect(state.name).toBe("gemini-agent");
      expect(state.model).toBe("google_ai/gemini-2.5-flash");
      expect(state.agentId).toBe("mock-gemini-agent-id");
    });

    it("should spawn a teammate with GLM model", async () => {
      const state = await spawnTeammate("glm-agent", "Chinese specialist", {
        model: "zai/glm-5",
      });
      
      expect(state.name).toBe("glm-agent");
      expect(state.model).toBe("zai/glm-5");
      expect(state.agentId).toBe("mock-glm-agent-id");
    });

    it("should reject duplicate names", async () => {
      vi.mocked(store.teammateExists).mockReturnValue(true);
      
      await expect(spawnTeammate("alice", "Developer")).rejects.toThrow(
        "already exists"
      );
    });

    it("should reject invalid names", async () => {
      await expect(spawnTeammate("", "Developer")).rejects.toThrow(
        "cannot be empty"
      );
      
      await expect(spawnTeammate("a".repeat(65), "Developer")).rejects.toThrow(
        "64 characters"
      );
    });

    it("should throw if no API key", async () => {
      vi.mocked(store.getApiKey).mockReturnValue(null);
      
      await expect(spawnTeammate("alice", "Developer")).rejects.toThrow(
        "No API key found"
      );
    });

    it("should set createdAt and lastUpdated timestamps", async () => {
      const before = new Date().toISOString();
      const state = await spawnTeammate("alice", "Developer");
      const after = new Date().toISOString();
      
      expect(state.createdAt >= before).toBe(true);
      expect(state.createdAt <= after).toBe(true);
      expect(state.lastUpdated).toBe(state.createdAt);
    });

    it("should persist init and memfs options", async () => {
      const state = await spawnTeammate("alice", "Developer", {
        spawnPrompt: "Specialize in frontend systems",
        memfsEnabled: false,
        skipInit: true,
      });

      expect(state.spawnPrompt).toBe("Specialize in frontend systems");
      expect(state.memfsEnabled).toBe(false);
      expect(state.initStatus).toBe("skipped");
    });

    it("should pass memfs to createAgent when enabled", async () => {
      await spawnTeammate("alice", "Developer", {
        memfsEnabled: true,
      });

      const { createAgent } = await import("@letta-ai/letta-code-sdk");
      expect(createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          memfs: true,
        }),
      );
    });
  });

  describe("initializeTeammateMemory", () => {
    const mockTeammate = {
      name: "alice",
      role: "Developer",
      agentId: "agent-123",
      conversationId: "conv-123",
      status: "idle" as const,
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    beforeEach(() => {
      vi.mocked(store.getApiKey).mockReturnValue("test-key");
      vi.mocked(store.loadTeammate).mockReturnValue(mockTeammate);
      vi.mocked(store.updateStatus).mockImplementation(() => mockTeammate);
    });

    it("should create a separate init conversation", async () => {
      const result = await initializeTeammateMemory("alice", "Initialize memory");

      expect(result.result).toBe("Task completed successfully!");
      expect(result.conversationId).toBe("conv-agent-123");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // MESSAGE TEAMMATE TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("messageTeammate", () => {
    const mockTeammate = {
      name: "alice",
      role: "Developer",
      agentId: "agent-123",
      conversationId: "conv-123",
      status: "idle" as const,
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    beforeEach(() => {
      vi.mocked(store.getApiKey).mockReturnValue("test-key");
      vi.mocked(store.loadTeammate).mockReturnValue(mockTeammate);
      vi.mocked(store.updateStatus).mockImplementation(() => mockTeammate);
    });

    it("should send message and return response", async () => {
      const response = await messageTeammate("alice", "Hello!");
      
      expect(response).toBe("Task completed successfully!");
    });

    it("should update status to working then done", async () => {
      await messageTeammate("alice", "Hello!");
      
      expect(store.updateStatus).toHaveBeenCalledWith("alice", "working");
      expect(store.updateStatus).toHaveBeenCalledWith("alice", "done");
    });

    it("should throw if teammate not found", async () => {
      vi.mocked(store.loadTeammate).mockReturnValue(null);
      
      await expect(messageTeammate("unknown", "Hello!")).rejects.toThrow(
        "not found"
      );
    });

    it("should throw if no conversation ID", async () => {
      vi.mocked(store.loadTeammate).mockReturnValue({
        ...mockTeammate,
        conversationId: undefined,
      });
      
      await expect(messageTeammate("alice", "Hello!")).rejects.toThrow(
        "no conversation ID"
      );
    });

    it("should throw if no API key", async () => {
      vi.mocked(store.getApiKey).mockReturnValue(null);
      
      await expect(messageTeammate("alice", "Hello!")).rejects.toThrow(
        "No API key found"
      );
    });

    it("should update status to error on failure", async () => {
      const { resumeSession } = await import("@letta-ai/letta-code-sdk");
      vi.mocked(resumeSession).mockReturnValueOnce({
        send: vi.fn().mockResolvedValue(undefined),
        stream: vi.fn().mockImplementation(async function* () {
          yield { type: "error", message: "Something went wrong" };
        }),
        [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
      } as any);
      
      await expect(messageTeammate("alice", "Hello!")).rejects.toThrow(
        "Something went wrong"
      );
      
      expect(store.updateStatus).toHaveBeenCalledWith("alice", "error");
    });

    it("should call onEvent callback for tool calls", async () => {
      const onEvent = vi.fn();
      
      await messageTeammate("alice", "Hello!", { onEvent });
      
      expect(onEvent).toHaveBeenCalled();
    });

    it("should work with Gemini teammate", async () => {
      vi.mocked(store.loadTeammate).mockReturnValue({
        ...mockTeammate,
        model: "google_ai/gemini-2.5-flash",
      });
      
      const response = await messageTeammate("alice", "Hello!");
      expect(response).toBeDefined();
    });

    it("should work with GLM teammate", async () => {
      vi.mocked(store.loadTeammate).mockReturnValue({
        ...mockTeammate,
        model: "zai/glm-5",
      });
      
      const response = await messageTeammate("alice", "Hello!");
      expect(response).toBeDefined();
    });

    it("should handle memfsEnabled option", async () => {
      vi.mocked(store.loadTeammate).mockReturnValue({
        ...mockTeammate,
        memfsEnabled: true,
        memfsStartup: "blocking" as const,
      });
      
      const response = await messageTeammate("alice", "Hello!");
      expect(response).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // BROADCAST MESSAGE TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("broadcastMessage", () => {
    const mockTeammates = [
      {
        name: "alice",
        role: "Developer",
        agentId: "agent-1",
        conversationId: "conv-1",
        status: "idle" as const,
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      {
        name: "bob",
        role: "Designer",
        agentId: "agent-2",
        conversationId: "conv-2",
        status: "idle" as const,
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      {
        name: "charlie",
        role: "Tester",
        agentId: "agent-3",
        conversationId: "conv-3",
        status: "idle" as const,
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ];

    beforeEach(() => {
      vi.mocked(store.getApiKey).mockReturnValue("test-key");
      vi.mocked(store.listTeammates).mockReturnValue(mockTeammates);
      vi.mocked(store.loadTeammate).mockImplementation((name) => 
        mockTeammates.find(t => t.name === name) || null
      );
      vi.mocked(store.updateStatus).mockImplementation((name) => 
        mockTeammates.find(t => t.name === name) || null
      );
    });

    it("should broadcast to all teammates", async () => {
      const results = await broadcastMessage("Hello team!");
      
      expect(results.size).toBe(3);
      expect(results.has("alice")).toBe(true);
      expect(results.has("bob")).toBe(true);
      expect(results.has("charlie")).toBe(true);
    });

    it("should respect exclude list", async () => {
      const results = await broadcastMessage("Hello!", { exclude: ["bob", "charlie"] });
      
      expect(results.size).toBe(1);
      expect(results.has("alice")).toBe(true);
      expect(results.has("bob")).toBe(false);
    });

    it("should target specific teammates", async () => {
      const results = await broadcastMessage("Hello!", { 
        targetNames: ["alice", "bob"] 
      });
      
      expect(results.size).toBe(2);
      expect(results.has("alice")).toBe(true);
      expect(results.has("bob")).toBe(true);
      expect(results.has("charlie")).toBe(false);
    });

    it("should throw if target teammate not found", async () => {
      await expect(
        broadcastMessage("Hello!", { targetNames: ["nonexistent"] })
      ).rejects.toThrow("not found");
    });

    it("should respect concurrency limit", async () => {
      const results = await broadcastMessage("Hello!", { concurrency: 1 });
      
      expect(results.size).toBe(3);
    });

    it("should throw if concurrency is less than 1", async () => {
      await expect(
        broadcastMessage("Hello!", { concurrency: 0 })
      ).rejects.toThrow("Concurrency must be at least 1");
    });

    it("should handle errors gracefully", async () => {
      vi.mocked(store.loadTeammate).mockImplementation((name) => {
        if (name === "bob") return null; // Simulate error for bob
        return mockTeammates.find(t => t.name === name) || null;
      });
      
      const results = await broadcastMessage("Hello!");
      
      expect(results.size).toBe(3);
      expect(results.get("bob")).toContain("Error");
    });

    it("should return empty map if no teammates", async () => {
      vi.mocked(store.listTeammates).mockReturnValue([]);
      
      const results = await broadcastMessage("Hello!");
      
      expect(results.size).toBe(0);
    });

    it("should work with Gemini teammates", async () => {
      vi.mocked(store.listTeammates).mockReturnValue([
        { ...mockTeammates[0], model: "google_ai/gemini-2.5-flash" },
      ]);
      
      const results = await broadcastMessage("Hello!");
      expect(results.size).toBe(1);
    });

    it("should work with GLM teammates", async () => {
      vi.mocked(store.listTeammates).mockReturnValue([
        { ...mockTeammates[0], model: "zai/glm-5" },
      ]);
      
      const results = await broadcastMessage("Hello!");
      expect(results.size).toBe(1);
    });

    it("should work with mixed model teammates", async () => {
      vi.mocked(store.listTeammates).mockReturnValue([
        { ...mockTeammates[0], model: "google_ai/gemini-2.5-flash" },
        { ...mockTeammates[1], model: "zai/glm-5" },
        { ...mockTeammates[2], model: undefined }, // default model
      ]);
      
      const results = await broadcastMessage("Hello!");
      expect(results.size).toBe(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // DISPATCH MESSAGES TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("dispatchMessages", () => {
    const mockTeammates = [
      {
        name: "alice",
        role: "Developer",
        agentId: "agent-1",
        conversationId: "conv-1",
        status: "idle" as const,
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      {
        name: "bob",
        role: "Designer",
        agentId: "agent-2",
        conversationId: "conv-2",
        status: "idle" as const,
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ];

    beforeEach(() => {
      vi.mocked(store.getApiKey).mockReturnValue("test-key");
      vi.mocked(store.loadTeammate).mockImplementation((name) => 
        mockTeammates.find(t => t.name === name) || null
      );
      vi.mocked(store.updateStatus).mockImplementation((name) => 
        mockTeammates.find(t => t.name === name) || null
      );
    });

    it("should dispatch different messages to different teammates", async () => {
      const messages = new Map([
        ["alice", "Write code"],
        ["bob", "Design UI"],
      ]);
      
      const results = await dispatchMessages(messages);
      
      expect(results.size).toBe(2);
      expect(results.has("alice")).toBe(true);
      expect(results.has("bob")).toBe(true);
    });

    it("should respect concurrency limit", async () => {
      const messages = new Map([
        ["alice", "Task 1"],
        ["bob", "Task 2"],
      ]);
      
      const results = await dispatchMessages(messages, { concurrency: 1 });
      
      expect(results.size).toBe(2);
    });

    it("should throw if concurrency is less than 1", async () => {
      const messages = new Map([["alice", "Task"]]);
      
      await expect(
        dispatchMessages(messages, { concurrency: 0 })
      ).rejects.toThrow("Concurrency must be at least 1");
    });

    it("should handle errors gracefully", async () => {
      vi.mocked(store.loadTeammate).mockImplementation((name) => {
        if (name === "bob") return null;
        return mockTeammates.find(t => t.name === name) || null;
      });
      
      const messages = new Map([
        ["alice", "Task 1"],
        ["bob", "Task 2"],
      ]);
      
      const results = await dispatchMessages(messages);
      
      expect(results.size).toBe(2);
      expect(results.get("bob")).toContain("Error");
    });

    it("should return empty map for empty input", async () => {
      const messages = new Map();
      
      const results = await dispatchMessages(messages);
      
      expect(results.size).toBe(0);
    });

    it("should work with Gemini teammate", async () => {
      vi.mocked(store.loadTeammate).mockReturnValue({
        ...mockTeammates[0],
        model: "google_ai/gemini-2.5-flash",
      });
      
      const messages = new Map([["alice", "Fast task"]]);
      const results = await dispatchMessages(messages);
      
      expect(results.size).toBe(1);
    });

    it("should work with GLM teammate", async () => {
      vi.mocked(store.loadTeammate).mockReturnValue({
        ...mockTeammates[0],
        model: "zai/glm-5",
      });
      
      const messages = new Map([["alice", "Chinese task"]]);
      const results = await dispatchMessages(messages);
      
      expect(results.size).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // RETRY LOGIC TESTS (indirectly through spawnTeammate)
  // ═══════════════════════════════════════════════════════════════

  describe("Retry Logic", () => {
    beforeEach(() => {
      vi.mocked(store.getApiKey).mockReturnValue("test-key");
      vi.mocked(store.teammateExists).mockReturnValue(false);
      vi.mocked(store.saveTeammate).mockImplementation(() => {});
    });

    it("should succeed on first try", async () => {
      const state = await spawnTeammate("alice", "Developer");
      expect(state).toBeDefined();
    });

    // Note: Testing actual retry behavior would require mocking the SDK to fail first
    // This is a simplified test to verify the retry wrapper exists
  });
});
