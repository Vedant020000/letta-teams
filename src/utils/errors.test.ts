import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleCliError } from "./errors.js";

describe("Error Handling", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock console.error
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    
    // Mock process.exit to throw so we can test it was called
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  // ═══════════════════════════════════════════════════════════════
  // JSON MODE TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("JSON Mode", () => {
    it("should output JSON error format", () => {
      try {
        handleCliError(new Error("test error"), true);
      } catch (e) {
        // Expected to throw from process.exit mock
      }
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        JSON.stringify({ error: "test error" })
      );
    });

    it("should output JSON with complex error message", () => {
      try {
        handleCliError(new Error("Failed to spawn agent: API key invalid"), true);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        JSON.stringify({ error: "Failed to spawn agent: API key invalid" })
      );
    });

    it("should output valid JSON for special characters", () => {
      try {
        handleCliError(new Error('Error with "quotes" and \\backslash'), true);
      } catch (e) {}
      
      const callArg = consoleErrorSpy.mock.calls[0][0];
      // Should be valid JSON
      expect(() => JSON.parse(callArg)).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // HUMAN-READABLE MODE TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Human-Readable Mode", () => {
    it("should output human-readable error format", () => {
      try {
        handleCliError(new Error("test error"), false);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error: test error");
    });

    it("should output human-readable with prefix", () => {
      try {
        handleCliError(new Error("Teammate not found"), false);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Teammate not found");
    });

    it("should handle multiline error messages", () => {
      try {
        handleCliError(new Error("Line 1\nLine 2\nLine 3"), false);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Line 1\nLine 2\nLine 3");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // NON-ERROR OBJECT TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Non-Error Objects", () => {
    it("should handle string errors", () => {
      try {
        handleCliError("string error", false);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error: string error");
    });

    it("should handle string errors in JSON mode", () => {
      try {
        handleCliError("string error", true);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        JSON.stringify({ error: "string error" })
      );
    });

    it("should handle number errors", () => {
      try {
        handleCliError(42, false);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error: 42");
    });

    it("should handle null errors", () => {
      try {
        handleCliError(null, false);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error: null");
    });

    it("should handle undefined errors", () => {
      try {
        handleCliError(undefined, false);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error: undefined");
    });

    it("should handle object errors", () => {
      try {
        handleCliError({ code: "ENOENT" }, false);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error: [object Object]");
    });

    it("should handle array errors", () => {
      try {
        handleCliError(["error1", "error2"], false);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error: error1,error2");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PROCESS EXIT TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Process Exit", () => {
    it("should call process.exit with code 1", () => {
      try {
        handleCliError(new Error("test"), false);
      } catch (e) {}
      
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should call process.exit in JSON mode", () => {
      try {
        handleCliError(new Error("test"), true);
      } catch (e) {}
      
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it("should always exit with code 1 regardless of error type", () => {
      const errors = [
        new Error("error"),
        "string error",
        42,
        null,
        undefined,
        { code: "ERROR" },
      ];
      
      for (const err of errors) {
        processExitSpy.mockClear();
        try {
          handleCliError(err, false);
        } catch (e) {}
        expect(processExitSpy).toHaveBeenCalledWith(1);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // RETURN TYPE TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Return Type", () => {
    it("should have return type 'never'", () => {
      // This is a compile-time check
      // The function should never return normally
      // It always throws (via process.exit mock) or exits
      
      let returned = false;
      try {
        handleCliError(new Error("test"), false);
        returned = true;
      } catch (e) {
        // Expected
      }
      
      expect(returned).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EDGE CASES
  // ═══════════════════════════════════════════════════════════════

  describe("Edge Cases", () => {
    it("should handle empty string error", () => {
      try {
        handleCliError("", false);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error: ");
    });

    it("should handle error with very long message", () => {
      const longMessage = "a".repeat(10000);
      try {
        handleCliError(new Error(longMessage), false);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(`Error: ${longMessage}`);
    });

    it("should handle error with unicode characters", () => {
      try {
        handleCliError(new Error("Error: 你好世界 🌍"), false);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Error: 你好世界 🌍");
    });

    it("should handle error with newlines and tabs", () => {
      try {
        handleCliError(new Error("Line 1\n\tLine 2\n\t\tLine 3"), false);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: Line 1\n\tLine 2\n\t\tLine 3"
      );
    });

    it("should handle Error with custom properties", () => {
      const customError = new Error("Custom error");
      (customError as any).code = "CUSTOM_ERROR";
      (customError as any).statusCode = 500;
      
      try {
        handleCliError(customError, false);
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Custom error");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // MODEL-SPECIFIC ERROR TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Model-Specific Errors", () => {
    it("should handle Gemini model errors", () => {
      try {
        handleCliError(
          new Error("google_ai/gemini-2.5-flash: rate limit exceeded"),
          false
        );
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: google_ai/gemini-2.5-flash: rate limit exceeded"
      );
    });

    it("should handle GLM model errors", () => {
      try {
        handleCliError(
          new Error("zai/glm-5: model unavailable"),
          false
        );
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error: zai/glm-5: model unavailable"
      );
    });

    it("should handle model errors in JSON mode", () => {
      try {
        handleCliError(
          new Error("Model google_ai/gemini-2.5-flash not found"),
          true
        );
      } catch (e) {}
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        JSON.stringify({ error: "Model google_ai/gemini-2.5-flash not found" })
      );
    });
  });
});
