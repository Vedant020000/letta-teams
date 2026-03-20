/**
 * Auth token storage (in home directory for security)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";

const LTEAMS_DIR = ".lteams";
const AUTH_FILE = "authtoken.json";

/**
 * Auth token storage structure
 */
export interface AuthToken {
  apiKey: string;
  createdAt: string;
}

/**
 * Get the global auth directory path (in home directory)
 */
export function getGlobalAuthDir(): string {
  return path.join(os.homedir(), LTEAMS_DIR);
}

/**
 * Ensure the global auth directory exists
 */
export function ensureGlobalAuthDir(): void {
  const dir = getGlobalAuthDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get the path to the auth token file (in home directory)
 */
export function getAuthPath(): string {
  return path.join(getGlobalAuthDir(), AUTH_FILE);
}

/**
 * Check if an auth token exists
 */
export function hasAuthToken(): boolean {
  return fs.existsSync(getAuthPath());
}

/**
 * Load the auth token
 * Returns null if not found or corrupted
 */
export function loadAuthToken(): AuthToken | null {
  const filePath = getAuthPath();
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as AuthToken;
  } catch {
    return null;
  }
}

/**
 * Get the API key from env var or storage
 * Priority: LETTA_API_KEY env var > stored token
 * (Env vars override stored config - standard CLI convention)
 */
export function getApiKey(): string | null {
  // First check env var (takes priority)
  if (process.env.LETTA_API_KEY) {
    return process.env.LETTA_API_KEY;
  }
  // Fall back to stored token
  const token = loadAuthToken();
  return token?.apiKey || null;
}

/**
 * Save the auth token (in home directory)
 * Sets restrictive file permissions (0600) on Unix-like systems
 */
export function saveAuthToken(apiKey: string): AuthToken {
  ensureGlobalAuthDir();
  const token: AuthToken = {
    apiKey,
    createdAt: new Date().toISOString(),
  };
  const filePath = getAuthPath();
  fs.writeFileSync(filePath, JSON.stringify(token, null, 2));

  // Set restrictive permissions (read/write for owner only)
  // This works on Unix-like systems; on Windows it's a no-op
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore chmod errors on Windows or unsupported filesystems
  }

  return token;
}

/**
 * Clear the auth token
 */
export function clearAuthToken(): boolean {
  const filePath = getAuthPath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Prompt user for API key interactively
 */
export async function promptForApiKey(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.question("Enter your Letta API key: ", (answer) => {
      rl.close();
      const key = answer.trim();
      if (!key) {
        reject(new Error("API key cannot be empty"));
      } else {
        resolve(key);
      }
    });
  });
}
