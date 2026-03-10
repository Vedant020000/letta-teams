import { vi } from "vitest";

// Mock createAgent - returns a mock agent ID
export const createAgent = vi.fn().mockImplementation(async (options?: { model?: string }) => {
  // Simulate different agent IDs based on model for testing
  if (options?.model === "google_ai/gemini-2.5-flash") {
    return "mock-gemini-agent-id";
  }
  if (options?.model === "zai/glm-5") {
    return "mock-glm-agent-id";
  }
  return "mock-agent-id";
});

// Mock createSession - returns a session object with stream
export const createSession = vi.fn().mockImplementation((agentId: string, options?: Record<string, unknown>) => {
  let conversationId = "mock-conversation-id";

  // Different conversation IDs for different agents
  if (agentId === "mock-gemini-agent-id") {
    conversationId = "mock-gemini-conversation-id";
  } else if (agentId === "mock-glm-agent-id") {
    conversationId = "mock-glm-conversation-id";
  }

  return {
    agentId,
    conversationId,
    permissionMode: options?.permissionMode || "bypassPermissions",
    send: vi.fn().mockResolvedValue(undefined),
    stream: vi.fn().mockImplementation(async function* () {
      yield { type: "assistant", content: "Working on it..." };
      yield { type: "tool_call", toolName: "Read", toolInput: { file_path: "/test/file.ts" } };
      yield { type: "tool_result", content: "file contents", isError: false };
      yield { type: "result", result: "Task completed successfully!" };
    }),
    [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock resumeSession - returns a session object with stream
export const resumeSession = vi.fn().mockImplementation((conversationId: string, options?: Record<string, unknown>) => {
  return {
    conversationId,
    permissionMode: options?.permissionMode || "bypassPermissions",
    send: vi.fn().mockResolvedValue(undefined),
    stream: vi.fn().mockImplementation(async function* () {
      yield { type: "assistant", content: "Resuming work..." };
      yield { type: "result", result: "Resumed task completed!" };
    }),
    [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
  };
});

// Reset all mocks between tests
export const resetMocks = () => {
  createAgent.mockClear();
  createSession.mockClear();
  resumeSession.mockClear();
};
