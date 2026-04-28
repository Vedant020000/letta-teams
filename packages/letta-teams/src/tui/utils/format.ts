import type { TeammateStatus, TaskStatus } from 'letta-teams-sdk/types';

/**
 * Format a progress bar
 */
export function formatProgressBar(progress: number, width: number = 10): string {
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Get status icon for agent
 */
export function getStatusIcon(status: TeammateStatus): string {
  switch (status) {
    case 'working':
      return '●';
    case 'idle':
      return '○';
    case 'done':
      return '✓';
    case 'error':
      return '✗';
    default:
      return '○';
  }
}

/**
 * Get color for status
 */
export function getStatusColor(status: TeammateStatus): string {
  switch (status) {
    case 'working':
      return 'yellow';
    case 'idle':
      return 'gray';
    case 'done':
      return 'green';
    case 'error':
      return 'red';
    default:
      return 'gray';
  }
}

/**
 * Get task status icon
 */
export function getTaskStatusIcon(status: TaskStatus): string {
  switch (status) {
    case 'pending':
      return '○';
    case 'running':
      return '●';
    case 'done':
      return '✓';
    case 'error':
      return '✗';
    default:
      return '○';
  }
}

/**
 * Get task status color
 */
export function getTaskStatusColor(status: TaskStatus): string {
  switch (status) {
    case 'pending':
      return 'gray';
    case 'running':
      return 'yellow';
    case 'done':
      return 'green';
    case 'error':
      return 'red';
    default:
      return 'gray';
  }
}

/**
 * Format relative time
 */
export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

/**
 * Format duration
 */
export function formatDuration(startIso: string, endIso?: string): string {
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : new Date();
  const diffMs = end.getTime() - start.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffSecs = Math.floor((diffMs % 60000) / 1000);

  if (diffMins === 0) return `${diffSecs}s`;
  return `${diffMins}m ${diffSecs}s`;
}

/**
 * Truncate text
 */
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}


