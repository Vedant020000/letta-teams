import React from 'react';
import { Box, Text } from 'ink';
import type { TaskState } from 'letta-teams-sdk/types';
import {
  getTaskStatusIcon,
  getTaskStatusColor,
  formatRelativeTime,
  truncate,
} from '../utils/format.js';

interface TaskListProps {
  tasks: TaskState[];
  selectedIndex: number;
  includeInternal?: boolean;
}

const TaskList: React.FC<TaskListProps> = ({ tasks, selectedIndex, includeInternal = false }) => {
  if (tasks.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>No tasks found.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>
        TASKS ({tasks.length})
        <Text dimColor>{includeInternal ? ' [internal: on]' : ' [internal: off]'}</Text>
      </Text>
      <Box borderStyle="single" borderColor="gray" flexDirection="column">
        {tasks.slice(0, 10).map((task, index) => {
          const isSelected = index === selectedIndex;
          const icon = getTaskStatusIcon(task.status);
          const color = getTaskStatusColor(task.status);
          const time = formatRelativeTime(task.createdAt);
          const message = truncate(task.message, 40);

          return (
            <Box key={task.id} paddingX={1}>
              <Text
                bold={isSelected}
                color={isSelected ? 'white' : undefined}
                inverse={isSelected}
              >
                {isSelected ? ' ' : ''}
                <Text color={color}>{icon}</Text>
                {' '}
                {truncate(task.id, 18).padEnd(18)}
                {' '}
                {task.teammateName.padEnd(12).slice(0, 12)}
                {' '}
                <Text color={color}>{task.status.padEnd(7)}</Text>
                {' '}
                <Text dimColor>{time.padEnd(8)}</Text>
                {' '}
                <Text dimColor>{message}</Text>
                {isSelected ? ' ' : ''}
              </Text>
            </Box>
          );
        })}
        {tasks.length > 10 && (
          <Box paddingX={1}>
            <Text dimColor>... and {tasks.length - 10} more</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default TaskList;


