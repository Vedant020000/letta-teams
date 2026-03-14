import React from 'react';
import { Box, Text } from 'ink';
import type { TeammateState } from '../../types.js';
import {
  formatProgressBar,
  getStatusIcon,
  getStatusColor,
  formatRelativeTime,
  truncate,
} from '../utils/format.js';

interface AgentDetailsTabProps {
  teammates: TeammateState[];
  selectedIndex: number;
}

const AgentDetailsTab: React.FC<AgentDetailsTabProps> = ({ teammates, selectedIndex }) => {
  if (teammates.length === 0) {
    return (
      <Box paddingX={1} paddingY={1} flexDirection="column">
        <Text bold>AGENT DETAILS</Text>
        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>No agents found. Use 'letta-teams spawn &lt;name&gt; &lt;role&gt;' to create one.</Text>
        </Box>
      </Box>
    );
  }

  const selectedAgent = teammates[selectedIndex];

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Text bold>AGENT DETAILS ({teammates.length}) - ←→ to select</Text>

      {/* Agent selector bar */}
      <Box borderStyle="single" borderColor="gray" marginBottom={1}>
        {teammates.map((agent, index) => {
          const isSelected = index === selectedIndex;
          const icon = getStatusIcon(agent.status);
          const color = getStatusColor(agent.status);

          return (
            <Box key={agent.name} paddingX={1}>
              <Text
                bold={isSelected}
                color={isSelected ? 'white' : undefined}
                inverse={isSelected}
              >
                <Text color={color}>{icon}</Text>
                {' '}
                {isSelected ? '[' : ''}{truncate(agent.name, 12)}{isSelected ? ']' : ''}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Selected agent full details */}
      {selectedAgent && (
        <AgentCard agent={selectedAgent} />
      )}
    </Box>
  );
};

/**
 * Full detail card for a single agent
 */
const AgentCard: React.FC<{ agent: TeammateState }> = ({ agent }) => {
  const statusColor = getStatusColor(agent.status);
  const icon = getStatusIcon(agent.status);
  const memfsEnabled = agent.memfsEnabled !== false;
  const rootConversationId = agent.targets?.find(t => t.kind === 'root')?.conversationId;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      {/* Header */}
      <Box>
        <Text bold color="cyan">{icon} {agent.name}</Text>
        <Text dimColor> - {agent.role}</Text>
      </Box>

      {/* Identity */}
      <Box marginTop={1}>
        <Text dimColor>Agent ID: </Text>
        <Text>{agent.agentId}</Text>
      </Box>
      {agent.model && (
        <Box>
          <Text dimColor>Model: </Text>
          <Text>{agent.model}</Text>
        </Box>
      )}
      {rootConversationId && (
        <Box>
          <Text dimColor>Conversation: </Text>
          <Text>{truncate(rootConversationId, 40)}</Text>
        </Box>
      )}
      <Box>
        <Text dimColor>Memfs status: </Text>
        <Text color={memfsEnabled ? 'green' : 'gray'}>{memfsEnabled ? 'enabled' : 'disabled'}</Text>
      </Box>
      {memfsEnabled && agent.memfsLastSyncedAt && (
        <Box>
          <Text dimColor>Last synced: </Text>
          <Text>{formatRelativeTime(agent.memfsLastSyncedAt)}</Text>
          <Text dimColor> ({agent.memfsLastSyncedAt})</Text>
        </Box>
      )}

      {/* Status */}
      <Box marginTop={1}>
        <Text dimColor>Status: </Text>
        <Text color={statusColor} bold>{agent.status}</Text>
      </Box>

      {/* Progress */}
      {agent.progress !== undefined && (
        <Box>
          <Text dimColor>Progress: </Text>
          <Text color={statusColor}>{formatProgressBar(agent.progress, 20)}</Text>
          <Text> {agent.progress}%</Text>
          {agent.progressNote && (
            <Text dimColor> - {agent.progressNote}</Text>
          )}
        </Box>
      )}

      {/* Current Work */}
      {(agent.currentTask || agent.todo) && (
        <Box marginTop={1}>
          <Text dimColor>Current Task:</Text>
        </Box>
      )}
      {(agent.currentTask || agent.todo) && (
        <Box paddingX={2}>
          <Text color="yellow">{agent.currentTask || agent.todo}</Text>
        </Box>
      )}

      {/* Problem */}
      {agent.currentProblem && (
        <Box marginTop={1}>
          <Text dimColor>Problem: </Text>
          <Text color="red">{agent.currentProblem}</Text>
        </Box>
      )}
      {agent.errorDetails && (
        <Box paddingX={2}>
          <Text color="red">{truncate(agent.errorDetails, 200)}</Text>
        </Box>
      )}

      {/* Pending Tasks */}
      {agent.pendingTasks && agent.pendingTasks.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Pending Tasks ({agent.pendingTasks.length}):</Text>
          {agent.pendingTasks.slice(0, 5).map((task, i) => (
            <Box key={i} paddingX={2}>
              <Text dimColor>{i + 1}. </Text>
              <Text>{truncate(task, 60)}</Text>
            </Box>
          ))}
          {agent.pendingTasks.length > 5 && (
            <Box paddingX={2}>
              <Text dimColor>... and {agent.pendingTasks.length - 5} more</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Completed Tasks */}
      {agent.completedTasks && agent.completedTasks.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>Completed Tasks: </Text>
          <Text color="green">{agent.completedTasks.length}</Text>
        </Box>
      )}

      {/* Timestamps */}
      <Box marginTop={1}>
        <Text dimColor>Last Updated: </Text>
        <Text>{formatRelativeTime(agent.lastUpdated)}</Text>
        <Text dimColor> | Created: </Text>
        <Text>{formatRelativeTime(agent.createdAt)}</Text>
      </Box>
    </Box>
  );
};

export default AgentDetailsTab;
