import React from 'react';
import { Box, Text } from 'ink';
import type { TeammateState } from 'letta-teams-sdk/types';
import { formatProgressBar, getStatusColor, formatRelativeTime } from '../utils/format.js';

interface AgentDetailProps {
  agent: TeammateState | null;
}

const AgentDetail: React.FC<AgentDetailProps> = ({ agent }) => {
  if (!agent) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>Select an agent to view details</Text>
      </Box>
    );
  }

  const statusColor = getStatusColor(agent.status);
  const summary = agent.statusSummary;
  const activeTodo = agent.todoItems?.find((item) => item.id === summary?.currentTodoId);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>SELECTED: {agent.name}</Text>
      <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
        <Box>
          <Text dimColor>Role: </Text>
          <Text>{agent.role}</Text>
        </Box>
        <Box>
          <Text dimColor>Model: </Text>
          <Text>{agent.model || 'default'}</Text>
        </Box>
        <Box>
          <Text dimColor>Status: </Text>
          <Text color={statusColor}>{agent.status}</Text>
        </Box>
        {summary?.progress !== undefined && (
          <Box>
            <Text dimColor>Progress: </Text>
            <Text color={statusColor}>{formatProgressBar(summary.progress, 10)}</Text>
            <Text> {summary.progress}%</Text>
          </Box>
        )}
        {summary?.message && (
          <Box>
            <Text dimColor>Status: </Text>
            <Text>{summary.phase} - {summary.message}</Text>
          </Box>
        )}
        {activeTodo && (
          <Box>
            <Text dimColor>Current Todo: </Text>
            <Text>{activeTodo.title}</Text>
          </Box>
        )}
        <Box>
          <Text dimColor>Last Updated: </Text>
          <Text>{formatRelativeTime(agent.lastUpdated)}</Text>
        </Box>
        {agent.todoItems && agent.todoItems.length > 0 && (
          <Box>
            <Text dimColor>Todos: </Text>
            <Text>{agent.todoItems.length} items</Text>
          </Box>
        )}
        {agent.statusEvents && agent.statusEvents.length > 0 && (
          <Box>
            <Text dimColor>Events: </Text>
            <Text>{agent.statusEvents.length}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default AgentDetail;


