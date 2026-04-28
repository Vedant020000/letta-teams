import { useState, useEffect, useCallback } from 'react';
import { listTeammates } from 'letta-teams-sdk/store';
import type { TeammateState } from 'letta-teams-sdk/types';

/**
 * Hook to load and poll teammates
 */
export function useTeammates(pollIntervalMs: number = 3000): {
  teammates: TeammateState[];
  refresh: () => void;
} {
  const [teammates, setTeammates] = useState<TeammateState[]>([]);

  const loadTeammates = useCallback(() => {
    try {
      const data = listTeammates();
      setTeammates(data);
    } catch (error) {
      console.error('Failed to load teammates:', error);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadTeammates();
  }, [loadTeammates]);

  // Polling
  useEffect(() => {
    const interval = setInterval(loadTeammates, pollIntervalMs);
    return () => clearInterval(interval);
  }, [loadTeammates, pollIntervalMs]);

  return { teammates, refresh: loadTeammates };
}


