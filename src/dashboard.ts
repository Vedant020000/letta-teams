/**
 * Dashboard module - activity-centric view of what's happening now
 */

import { listTeammates, loadTasks } from "./store.js";
import type { TeammateState, TaskState } from "./types.js";

/** Default number of recent items to show */
const DEFAULT_LIMIT = 10;

/** Maximum width for truncated text (configurable via env) */
const TRUNCATE_WIDTH = parseInt(process.env.DASHBOARD_WIDTH || "50", 10);

/** ANSI codes */
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

/**
 * Check if terminal supports ANSI codes
 */
function supportsAnsi(): boolean {
  return process.stdout.isTTY === true && process.env.TERM !== "dumb";
}

/**
 * Format relative time
 */
function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

/**
 * Render progress bar
 */
function renderProgressBar(progress?: number, width: number = 5): string {
  if (progress === undefined) return "";
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

/**
 * Truncate text to max length, adding ellipsis if needed
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

/**
 * Get first N lines of text
 */
function getFirstLines(text: string, lines: number): string[] {
  const allLines = text.split("\n").filter(l => l.trim());
  return allLines.slice(0, lines);
}

/**
 * Active item for NOW section (teammate working or with problem)
 */
interface ActiveItem {
  name: string;
  status: "working" | "error";
  task?: string;
  progress?: number;
  progressNote?: string;
  problem?: string;
}

/**
 * Dashboard data structure
 */
export interface DashboardData {
  now: ActiveItem[];
  recent: TaskState[];
  idle: string[];
}

/**
 * Get dashboard data by combining teammates and tasks
 */
export function getDashboardData(limit: number = DEFAULT_LIMIT): DashboardData {
  let teammates: TeammateState[];
  let tasks: TaskState[];
  
  try {
    teammates = listTeammates();
    tasks = Object.values(loadTasks());
  } catch (error) {
    // Handle store errors gracefully
    console.error("Failed to load dashboard data:", error);
    teammates = [];
    tasks = [];
  }

  // NOW: Teammates actively working or with problems
  const now: ActiveItem[] = teammates
    .filter(t => t.status === "working" || t.status === "error")
    .map(t => ({
      name: t.name,
      status: t.status as "working" | "error",
      task: t.currentTask,
      progress: t.progress,
      progressNote: t.progressNote,
      problem: t.currentProblem,
    }));

  // RECENT: Completed or error tasks, sorted by completion time
  const recent = tasks
    .filter(t => t.status === "done" || t.status === "error")
    .filter(t => t.completedAt) // Must have completion time
    .sort((a, b) => {
      const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, limit);

  // IDLE: Teammates not in NOW section
  const activeNames = new Set(now.map(n => n.name));
  const idle = teammates
    .filter(t => !activeNames.has(t.name))
    .map(t => t.name);

  return { now, recent, idle };
}

/**
 * Render the dashboard to console
 */
export function renderDashboard(data: DashboardData, verbose: boolean = false): void {
  const useAnsi = supportsAnsi();
  const a = useAnsi ? ANSI : { ...ANSI, reset: "", bold: "", dim: "", green: "", yellow: "", red: "", gray: "" };

  // ═══════════════════════════════════════════════════════════════
  // NOW SECTION
  // ═══════════════════════════════════════════════════════════════

  if (data.now.length > 0) {
    console.log(`${a.bold}NOW${a.reset}`);
    console.log(`${a.dim}────────────────────────────────────────────────────────────────${a.reset}`);

    for (const item of data.now) {
      const statusIcon = item.status === "working" ? `${a.yellow}●${a.reset}` : `${a.red}○${a.reset}`;
      const statusText = item.status === "working" ? "working" : "problem";

      // Name and status
      const name = item.name.padEnd(12).slice(0, 12);
      console.log(`${name}  ${statusIcon} ${statusText.padEnd(7)}`);

      // Task they're working on
      if (item.task) {
        const task = truncate(item.task, TRUNCATE_WIDTH);
        const progress = item.progress !== undefined ? ` [${renderProgressBar(item.progress, 5)}] ${item.progress}%` : "";
        console.log(`             ${a.dim}${task}${progress}${a.reset}`);
      }

      // Problem if any
      if (item.problem) {
        const problem = truncate(item.problem, TRUNCATE_WIDTH);
        console.log(`             ${a.red}⚠ ${problem}${a.reset}`);
      }

      console.log();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RECENT SECTION
  // ═══════════════════════════════════════════════════════════════

  if (data.recent.length > 0) {
    console.log(`${a.bold}RECENT${a.reset}`);
    console.log(`${a.dim}────────────────────────────────────────────────────────────────${a.reset}`);

    for (const task of data.recent) {
      const statusIcon = task.status === "done" ? `${a.green}✓${a.reset}` : `${a.red}✗${a.reset}`;
      const statusText = task.status === "done" ? "done" : "error";
      const time = task.completedAt ? formatRelativeTime(task.completedAt) : "?";

      // Name and status
      const name = task.teammateName.padEnd(12).slice(0, 12);
      console.log(`${name}  ${statusIcon} ${statusText.padEnd(5)}  ${a.dim}${time}${a.reset}`);

      // Message (what was asked)
      if (task.message) {
        const msg = truncate(task.message, TRUNCATE_WIDTH);
        console.log(`             ${a.dim}→ ${msg}${a.reset}`);
      }

      // Result or error
      const content = task.status === "done" ? task.result : task.error;
      if (content) {
        const lines = verbose ? getFirstLines(content, 10) : getFirstLines(content, 2);
        for (const line of lines) {
          const truncated = truncate(line, TRUNCATE_WIDTH);
          const color = task.status === "done" ? a.dim : a.red;
          console.log(`             ${color}${truncated}${a.reset}`);
        }
      }

      console.log();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // IDLE SECTION
  // ═══════════════════════════════════════════════════════════════

  if (data.idle.length > 0) {
    console.log(`${a.bold}IDLE${a.reset}`);
    console.log(`${a.dim}────────────────────────────────────────────────────────────────${a.reset}`);

    const idleList = data.idle.join(", ");
    console.log(`${a.gray}${idleList}${a.reset}`);
    console.log();
  }

  // Empty state
  if (data.now.length === 0 && data.recent.length === 0 && data.idle.length === 0) {
    console.log(`${a.dim}No teammates found. Use 'letta-teams spawn <name> <role>' to create one.${a.reset}`);
  }
}

/**
 * Display dashboard once and exit
 */
export function displayDashboard(options: { limit?: number; verbose?: boolean; json?: boolean } = {}): void {
  const { limit = DEFAULT_LIMIT, verbose = false, json = false } = options;
  const data = getDashboardData(limit);

  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    renderDashboard(data, verbose);
  }
}

/**
 * Get a one-time snapshot (for programmatic use)
 */
export function getSnapshot(): DashboardData {
  return getDashboardData(DEFAULT_LIMIT);
}
