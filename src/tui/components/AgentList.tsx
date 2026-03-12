import React from 'react';
import { Box, Text } from 'ink';
import type { TeammateState } from '../../types.js';
import { formatProgressBar, getStatusIcon, getStatusColor } from '../utils/format.js';

interface AgentListProps {
  teammates: TeammateState[];
  selectedIndex: number;
}

const AgentList: React.FC<AgentListProps> = ({ teammates, selectedIndex }) => {
  if (teammates.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>No agents found. Use 'letta-teams spawn &lt;name&gt; &lt;role&gt;' to create one.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>AGENTS ({teammates.length})</Text>
      <Box borderStyle="single" borderColor="gray" flexDirection="column">
        {teammates.map((agent, index) => {
          const isSelected = index === selectedIndex;
          const status = agent.status || 'idle';
          const icon = getStatusIcon(status);
          const color = getStatusColor(status);
          const progress = agent.progress !== undefined
            ? formatProgressBar(agent.progress, 10)
            : '░'.repeat(10);
          const task = agent.currentTask || agent.todo || 'No task assigned';

          return (
            <Box key={agent.name} paddingX={1}>
              <Text
                bold={isSelected}
                color={isSelected ? 'white' : undefined}
                inverse={isSelected}
              >
                {isSelected ? ' ' : ''}
                {icon} {agent.name.padEnd(16).slice(0, 16)}
                {' '}
                {status.padEnd(7)}
                {' '}
                <Text color={color}>{progress}</Text>
                {' '}
                <Text dimColor>{task.slice(0, 30)}</Text>
                {isSelected ? ' ' : ''}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default AgentList;
