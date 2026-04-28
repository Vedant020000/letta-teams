export type TeamsErrorCode =
  | "TEAMMATE_ALREADY_EXISTS"
  | "TEAMMATE_NOT_FOUND"
  | "TARGET_ALREADY_EXISTS"
  | "TARGET_NOT_FOUND"
  | "TASK_NOT_FOUND"
  | "INVALID_NAME"
  | "INVALID_TARGET_NAME"
  | "INVALID_CONTEXT_WINDOW"
  | "API_KEY_MISSING"
  | "DAEMON_START_FAILED"
  | "MEMFS_SYNC_FAILED";

export class TeamsError extends Error {
  readonly code: TeamsErrorCode;
  readonly cause?: unknown;

  constructor(code: TeamsErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "TeamsError";
    this.code = code;
    this.cause = options?.cause;
  }
}

export function isTeamsError(error: unknown): error is TeamsError {
  return error instanceof TeamsError;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
