import { vi } from "vitest";

// Mock process.exit to prevent actual exit during tests
vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
  throw new Error(`process.exit(${code})`);
});

// Set test API key
vi.stubEnv("LETTA_API_KEY", "test-api-key");

// Suppress console output during tests (optional - comment out for debugging)
// vi.spyOn(console, "log").mockImplementation(() => {});
// vi.spyOn(console, "warn").mockImplementation(() => {});
// vi.spyOn(console, "error").mockImplementation(() => {});
