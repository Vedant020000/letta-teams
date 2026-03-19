import { useState, useEffect, useCallback } from 'react';
import { listTasks } from '../../store.js';
import type { TaskState } from '../../types.js';
import { filterVisibleTasks } from '../../task-visibility.js';

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
