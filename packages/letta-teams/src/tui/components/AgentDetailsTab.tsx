import React from 'react';
import { Box, Text } from 'ink';
import type { TeammateState } from 'letta-teams-sdk/types';
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
  const summary = agent.statusSummary;
  const activeTodo = agent.todoItems?.find((item) => item.id === summary?.currentTodoId);

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
      {summary?.progress !== undefined && (
        <Box>
          <Text dimColor>Progress: </Text>
          <Text color={statusColor}>{formatProgressBar(summary.progress, 20)}</Text>
          <Text> {summary.progress}%</Text>
        </Box>
      )}

      {/* Current Work */}
      {summary?.message && (
        <Box marginTop={1}>
          <Text dimColor>Status Summary:</Text>
        </Box>
      )}
      {summary?.message && (
        <Box paddingX={2}>
          <Text color="yellow">{summary.phase} - {summary.message}</Text>
        </Box>
      )}
      {activeTodo && (
        <Box paddingX={2}>
          <Text dimColor>Current Todo: </Text>
          <Text>{activeTodo.title}</Text>
        </Box>
      )}

      {/* Problem */}
      {summary?.phase === 'blocked' && (
        <Box marginTop={1}>
          <Text dimColor>Problem: </Text>
          <Text color="red">{summary.message}</Text>
        </Box>
      )}
      {agent.errorDetails && (
        <Box paddingX={2}>
          <Text color="red">{truncate(agent.errorDetails, 200)}</Text>
        </Box>
      )}

      {/* Todo Items */}
      {agent.todoItems && agent.todoItems.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Todo Items ({agent.todoItems.length}):</Text>
          {agent.todoItems.slice(0, 5).map((item, i) => (
            <Box key={i} paddingX={2}>
              <Text dimColor>{i + 1}. </Text>
              <Text>{truncate(`[${item.state}] ${item.title}`, 60)}</Text>
            </Box>
          ))}
          {agent.todoItems.length > 5 && (
            <Box paddingX={2}>
              <Text dimColor>... and {agent.todoItems.length - 5} more</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Status Events */}
      {agent.statusEvents && agent.statusEvents.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>Status Events: </Text>
          <Text color="green">{agent.statusEvents.length}</Text>
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


