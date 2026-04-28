import { describe, expect, it } from "vitest";

import { TeamsError, isTeamsError, toErrorMessage } from "./errors.js";

describe("runtime errors", () => {
  it("creates typed teams errors", () => {
    const error = new TeamsError("TASK_NOT_FOUND", "Task missing");

    expect(error.name).toBe("TeamsError");
    expect(error.code).toBe("TASK_NOT_FOUND");
    expect(error.message).toBe("Task missing");
  });

  it("detects teams errors", () => {
    expect(isTeamsError(new TeamsError("INVALID_NAME", "bad name"))).toBe(true);
    expect(isTeamsError(new Error("plain"))).toBe(false);
  });

  it("normalizes unknown values into error messages", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
    expect(toErrorMessage("plain text")).toBe("plain text");
  });
});
