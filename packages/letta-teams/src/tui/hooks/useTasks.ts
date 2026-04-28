import { useState, useEffect, useCallback } from 'react';
import { listTasks } from 'letta-teams-sdk/store';
import type { TaskState } from 'letta-teams-sdk/types';
import { filterVisibleTasks } from 'letta-teams-sdk/task-visibility';

/**
 * Hook to load and poll tasks
 */
export function useTasks(pollIntervalMs: number = 3000, includeInternal: boolean = false): {
  tasks: TaskState[];
  refresh: () => void;
} {
  const [tasks, setTasks] = useState<TaskState[]>([]);

  const loadTasks = useCallback(() => {
    try {
      const data = listTasks();
      setTasks(filterVisibleTasks(data, includeInternal));
    } catch (error) {
      console.error('Failed to load tasks:', error);
    }
  }, [includeInternal]);

  // Initial load
  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Polling
  useEffect(() => {
    const interval = setInterval(loadTasks, pollIntervalMs);
    return () => clearInterval(interval);
  }, [loadTasks, pollIntervalMs]);

  return { tasks, refresh: loadTasks };
}


