import React from 'react';
import { Box, Text } from 'ink';
import type { TaskState } from 'letta-teams-sdk/types';
import {
  getTaskStatusColor,
  formatRelativeTime,
  formatDuration,
  truncate,
} from '../utils/format.js';

interface TaskDetailProps {
  task: TaskState | null;
}

const TaskDetail: React.FC<TaskDetailProps> = ({ task }) => {
  if (!task) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>Select a task to view details</Text>
      </Box>
    );
  }

  const statusColor = getTaskStatusColor(task.status);
  const duration = task.startedAt
    ? formatDuration(task.startedAt, task.completedAt)
    : '-';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>SELECTED: {task.id}</Text>
      <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
        <Box>
          <Text dimColor>Teammate: </Text>
          <Text>{task.teammateName}</Text>
        </Box>
        <Box>
          <Text dimColor>Status: </Text>
          <Text color={statusColor}>{task.status}</Text>
        </Box>
        <Box>
          <Text dimColor>Created: </Text>
          <Text>{formatRelativeTime(task.createdAt)}</Text>
        </Box>
        {task.startedAt && (
          <Box>
            <Text dimColor>Started: </Text>
            <Text>{formatRelativeTime(task.startedAt)}</Text>
          </Box>
        )}
        {task.completedAt && (
          <Box>
            <Text dimColor>Completed: </Text>
            <Text>{formatRelativeTime(task.completedAt)}</Text>
          </Box>
        )}
        <Box>
          <Text dimColor>Duration: </Text>
          <Text>{duration}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Message:</Text>
        </Box>
        <Box paddingX={1}>
          <Text>{truncate(task.message, 100)}</Text>
        </Box>
        {task.result && (
          <>
            <Box marginTop={1}>
              <Text dimColor>Result:</Text>
            </Box>
            <Box paddingX={1}>
              <Text color="green">{truncate(task.result, 200)}</Text>
            </Box>
          </>
        )}
        {task.error && (
          <>
            <Box marginTop={1}>
              <Text dimColor>Error:</Text>
            </Box>
            <Box paddingX={1}>
              <Text color="red">{truncate(task.error, 200)}</Text>
            </Box>
          </>
        )}
        {task.toolCalls && task.toolCalls.length > 0 && (
          <>
            <Box marginTop={1}>
              <Text dimColor>Tool Calls ({task.toolCalls.length}):</Text>
            </Box>
            <Box paddingX={1} flexDirection="column">
              {task.toolCalls.slice(0, 5).map((tc, i) => (
                <Box key={i}>
                  <Text color={tc.success ? 'green' : 'red'}>
                    {tc.success ? '✓' : '✗'}
                  </Text>
                  <Text> {tc.name}</Text>
                  {tc.input && <Text dimColor> "{truncate(tc.input, 30)}"</Text>}
                </Box>
              ))}
              {task.toolCalls.length > 5 && (
                <Text dimColor>... and {task.toolCalls.length - 5} more</Text>
              )}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
};

export default TaskDetail;


