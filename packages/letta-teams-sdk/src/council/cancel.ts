import Letta from '@letta-ai/letta-client';

import type { TeammateState } from '../types.js';
import { getApiKey, listConversationTargets, loadTasks, updateTask, updateStatus } from '../store.js';

export interface CancelCouncilRunsResult {
  cancelledTasks: number;
  cancelledConversations: number;
  warnings: string[];
}

export async function cancelRunsForCouncil(teammates: TeammateState[]): Promise<CancelCouncilRunsResult> {
  const warnings: string[] = [];
  const now = new Date().toISOString();

  let cancelledTasks = 0;
  const tasks = loadTasks();
  const teammateNames = new Set(teammates.map((teammate) => teammate.name));

  for (const task of Object.values(tasks)) {
    if (!teammateNames.has(task.teammateName)) continue;
    if (task.status !== 'pending' && task.status !== 'running') continue;
    updateTask(task.id, {
      status: 'error',
      error: 'Cancelled by council start',
      completedAt: now,
    });
    cancelledTasks += 1;
  }

  for (const teammate of teammates) {
    updateStatus(teammate.name, 'done');
  }

  let cancelledConversations = 0;
  try {
    const client = new Letta({ apiKey: getApiKey() });
    for (const teammate of teammates) {
      const targets = listConversationTargets(teammate.name);
      for (const target of targets) {
        try {
          await client.conversations.cancel(target.conversationId);
          cancelledConversations += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // 409 CONFLICT with "No active runs to cancel" means the run already completed.
          // This is not a real error - the desired state (no active run) is already achieved.
          if (message.includes('409') || message.includes('No active runs to cancel')) {
            continue;
          }
          warnings.push(`Failed to cancel ${target.name}: ${message}`);
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Cancel API unavailable: ${message}`);
  }

  return { cancelledTasks, cancelledConversations, warnings };
}
