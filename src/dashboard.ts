/**
 * Dashboard module - activity-centric view of what's happening now
 */

import { listTeammates, loadTasks } from "./store.js";
import type { TeammateState, TaskState } from "./types.js";
import { filterVisibleTasks } from './task-visibility.js';

/** Default number of recent items to show */
const DEFAULT_LIMIT = 10;

/** Maximum width for truncated text (configurable via env) */
const TRUNCATE_WIDTH = parseInt(process.env.DASHBOARD_WIDTH || "50", 10);

/** ANSI codes */
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
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

function formatPhase(phase?: string): string {
  if (!phase) return "";
  return phase.replace(/_/g, " ").toUpperCase();
}

/**
 * Active item for NOW section (teammate working or with problem)
 */
interface ActiveItem {
  name: string;
  status: "working" | "error";
  message?: string;
  phase?: string;
  currentTodoTitle?: string;
  progress?: number;
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

export interface DashboardRenderOptions {
  detail?: boolean;
  verbose?: boolean;
}

export interface DashboardQueryOptions {
  limit?: number;
  sinceMinutes?: number;
  includeInternal?: boolean;
}

/**
 * Get dashboard data by combining teammates and tasks
 */
export function getDashboardData(options: DashboardQueryOptions = {}): DashboardData {
  const { limit = DEFAULT_LIMIT, sinceMinutes = 24 * 60, includeInternal = false } = options;
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
      message: t.statusSummary?.message,
      phase: t.statusSummary?.phase,
      progress: t.statusSummary?.progress,
      currentTodoTitle: t.todoItems?.find((item) => item.id === t.statusSummary?.currentTodoId)?.title,
      problem: t.statusSummary?.phase === 'blocked' ? t.statusSummary.message : undefined,
    }));

  const visibleTasks = filterVisibleTasks(tasks, includeInternal);

  // RECENT: Completed or error tasks, sorted by completion time
  const cutoffMs = Date.now() - (sinceMinutes * 60 * 1000);

  const recent = visibleTasks
    .filter(t => t.status === "done" || t.status === "error")
    .filter(t => t.completedAt) // Must have completion time
    .filter((t) => {
      const completedMs = new Date(t.completedAt as string).getTime();
      return completedMs >= cutoffMs;
    })
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
export function renderDashboard(data: DashboardData, options: DashboardRenderOptions = {}): void {
  const { detail = false, verbose = false } = options;
  const useAnsi = supportsAnsi();
  const a = useAnsi ? ANSI : { ...ANSI, reset: "", bold: "", dim: "", cyan: "", green: "", yellow: "", red: "", gray: "" };

  const workingNow = data.now.filter((item) => item.status === 'working');
  const blockedNow = data.now.filter((item) => item.status === 'error' || item.phase === 'blocked');

  const summary = [
    `${a.yellow}${workingNow.length + blockedNow.length}${a.reset} active`,
    `${a.green}${data.recent.length}${a.reset} recent`,
    `${a.gray}${data.idle.length}${a.reset} idle`,
  ].join(`${a.dim} · ${a.reset}`);

  console.log(`${a.bold}${a.cyan}TEAM DASHBOARD${a.reset}`);
  console.log(`${a.dim}${summary}${a.reset}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════
  // NOW SECTION
  // ═══════════════════════════════════════════════════════════════

  if (workingNow.length > 0) {
    console.log(`${a.bold}NOW${a.reset}`);
    console.log();

    for (const item of workingNow) {
      const statusIcon = item.status === "working" ? `${a.yellow}●${a.reset}` : `${a.red}○${a.reset}`;
      const phaseText = item.phase ? formatPhase(item.phase) : 'WORKING';
      const progressText = item.progress !== undefined ? `${item.progress}%` : '-';
      const primary = truncate(item.message || item.currentTodoTitle || '-', TRUNCATE_WIDTH);

      const name = item.name.padEnd(12).slice(0, 12);
      if (!detail && !verbose) {
        console.log(`${name}  ${statusIcon} ${phaseText.padEnd(13)} ${progressText.padStart(4)}  ${primary}`);
      } else {
        const progress = item.progress !== undefined ? ` [${renderProgressBar(item.progress, 5)}] ${item.progress}%` : "";
        console.log(`${name}  ${statusIcon} ${a.dim}[${phaseText}]${a.reset}`);
        if (item.message) {
          console.log(`  ${a.dim}↳ ${truncate(item.message, TRUNCATE_WIDTH)}${progress}${a.reset}`);
        }
        if (item.currentTodoTitle) {
          console.log(`  ${a.dim}• todo: ${truncate(item.currentTodoTitle, TRUNCATE_WIDTH)}${a.reset}`);
        }
      }

      console.log();
    }
  }

  if (blockedNow.length > 0) {
    console.log(`${a.bold}BLOCKED${a.reset}`);
    console.log();

    for (const item of blockedNow) {
      const name = item.name.padEnd(12).slice(0, 12);
      const reason = truncate(item.problem || item.message || 'Blocked', TRUNCATE_WIDTH);

      if (!detail && !verbose) {
        console.log(`${name}  ${a.red}○${a.reset} BLOCKED        ${reason}`);
      } else {
        console.log(`${name}  ${a.red}○${a.reset} ${a.dim}[BLOCKED]${a.reset}`);
        console.log(`  ${a.red}⚠ ${reason}${a.reset}`);
        if (item.currentTodoTitle) {
          console.log(`  ${a.dim}• todo: ${truncate(item.currentTodoTitle, TRUNCATE_WIDTH)}${a.reset}`);
        }
      }

      console.log();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RECENT SECTION
  // ═══════════════════════════════════════════════════════════════

  if (data.recent.length > 0) {
    console.log(`${a.bold}RECENT${a.reset}`);
    console.log();

    for (const task of data.recent) {
      const statusIcon = task.status === "done" ? `${a.green}✓${a.reset}` : `${a.red}✗${a.reset}`;
      const time = task.completedAt ? formatRelativeTime(task.completedAt) : "?";
      const msg = truncate(task.message || '-', TRUNCATE_WIDTH);

      const name = task.teammateName.padEnd(12).slice(0, 12);
      if (!detail && !verbose) {
        console.log(`${statusIcon} ${name} ${a.dim}${time.padStart(7)}${a.reset}  ${msg}`);
      } else {
        const statusText = task.status === "done" ? "done" : "error";
        console.log(`${name}  ${statusIcon} ${statusText.padEnd(5)}  ${a.dim}${time}${a.reset}`);
        if (task.message) {
          console.log(`  ${a.dim}↳ ${truncate(task.message, TRUNCATE_WIDTH)}${a.reset}`);
        }

        const content = task.status === "done" ? task.result : task.error;
        if (content) {
          const lines = verbose ? getFirstLines(content, 10) : getFirstLines(content, 1);
          for (const line of lines) {
            const truncated = truncate(line, TRUNCATE_WIDTH);
            const color = task.status === "done" ? a.dim : a.red;
            console.log(`  ${color}${truncated}${a.reset}`);
          }
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
    console.log();

    const MAX_IDLE_NAMES = 6;
    const shown = data.idle.slice(0, MAX_IDLE_NAMES);
    const extra = data.idle.length - shown.length;
    const suffix = extra > 0 ? ` +${extra} more` : '';
    const idleList = `${shown.join(", ")}${suffix}`;
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
export function displayDashboard(
  options: {
    limit?: number;
    detail?: boolean;
    verbose?: boolean;
    json?: boolean;
    sinceMinutes?: number;
    includeInternal?: boolean;
  } = {},
): void {
  const {
    limit = DEFAULT_LIMIT,
    detail = false,
    verbose = false,
    json = false,
    sinceMinutes = 24 * 60,
    includeInternal = false,
  } = options;
  const data = getDashboardData({ limit, sinceMinutes, includeInternal });

  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    renderDashboard(data, { detail, verbose });
  }
}

/**
 * Get a one-time snapshot (for programmatic use)
 */
export function getSnapshot(): DashboardData {
  return getDashboardData({ limit: DEFAULT_LIMIT });
}
