import React from 'react';
import { Box, Text } from 'ink';
import type { TaskState, TeammateState } from 'letta-teams-sdk/types';
import { formatRelativeTime, truncate } from '../utils/format.js';

interface ActivityFeedProps {
  tasks: TaskState[];
  teammates: TeammateState[];
  includeInternal?: boolean;
}

interface ActivityItem {
  timestamp: string;
  agentName: string;
  action: string;
  detail: string;
  status: 'success' | 'error' | 'info';
}

const ActivityFeed: React.FC<ActivityFeedProps> = ({ tasks, teammates, includeInternal = false }) => {
  // Build activity items from tasks and teammates
  const activities: ActivityItem[] = [];

  // Add recent task completions/errors
  const recentTasks = tasks
    .filter(t => t.status === 'done' || t.status === 'error')
    .slice(0, 10);

  for (const task of recentTasks) {
    if (task.completedAt) {
      activities.push({
        timestamp: task.completedAt,
        agentName: task.teammateName,
        action: task.status === 'done' ? 'Completed task' : 'Task failed',
        detail: truncate(task.message, 50),
        status: task.status === 'done' ? 'success' : 'error',
      });
    }
  }

  // Add working agents
  for (const agent of teammates) {
    if (agent.statusSummary?.message) {
      activities.push({
        timestamp: agent.statusSummary.updatedAt,
        agentName: agent.name,
        action: `${agent.statusSummary.phase}:`,
        detail: truncate(agent.statusSummary.message, 50),
        status: 'info',
      });
    }
    if (agent.statusSummary?.phase === 'blocked') {
      activities.push({
        timestamp: agent.statusSummary.updatedAt,
        agentName: agent.name,
        action: 'Blocked:',
        detail: truncate(agent.statusSummary.message, 50),
        status: 'error',
      });
    }
  }

  // Sort by timestamp
  activities.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  if (activities.length === 0) {
    return (
      <Box paddingX={1} paddingY={1} flexDirection="column">
        <Text bold>
        ACTIVITY
        <Text dimColor>{includeInternal ? ' [internal: on]' : ' [internal: off]'}</Text>
      </Text>
        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>No recent activity</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>
        ACTIVITY
        <Text dimColor>{includeInternal ? ' [internal: on]' : ' [internal: off]'}</Text>
      </Text>
      <Box borderStyle="single" borderColor="gray" flexDirection="column">
        {activities.slice(0, 15).map((activity, index) => {
          const icon = activity.status === 'success' ? '✓' :
                       activity.status === 'error' ? '✗' : '●';
          const color = activity.status === 'success' ? 'green' :
                        activity.status === 'error' ? 'red' : 'yellow';
          const time = formatRelativeTime(activity.timestamp);

          return (
            <Box key={index} paddingX={1}>
              <Text color={color}>{icon}</Text>
              <Text dimColor> {time.padEnd(8)}</Text>
              <Text> {activity.agentName.padEnd(12).slice(0, 12)}</Text>
              <Text dimColor> {activity.action}</Text>
              <Text dimColor> {activity.detail}</Text>
            </Box>
          );
        })}
        {activities.length > 15 && (
          <Box paddingX={1}>
            <Text dimColor>... and {activities.length - 15} more</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default ActivityFeed;


