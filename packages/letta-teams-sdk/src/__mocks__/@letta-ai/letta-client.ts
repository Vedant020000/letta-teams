import { vi } from "vitest";

// Mock Letta client
const MockLetta = vi.fn().mockImplementation((options?: { apiKey?: string }) => ({
  apiKey: options?.apiKey,
  agents: {
    delete: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue({
      id: "mock-agent-id",
      name: "mock-agent",
      model: "google_ai/gemini-2.5-flash",
    }),
  },
}));

export default MockLetta;
