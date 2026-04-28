import React from 'react';
import { Box, Text } from 'ink';

type Tab = 'agents' | 'tasks' | 'activity' | 'details';

interface TabsProps {
  activeTab: Tab;
}

const tabs: { key: Tab; label: string; shortcut: string }[] = [
  { key: 'agents', label: 'Agents', shortcut: '1' },
  { key: 'tasks', label: 'Tasks', shortcut: '2' },
  { key: 'activity', label: 'Activity', shortcut: '3' },
  { key: 'details', label: 'Details', shortcut: '4' },
];

const Tabs: React.FC<TabsProps> = ({ activeTab }) => {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      {tabs.map((tab, index) => {
        const isActive = activeTab === tab.key;
        return (
          <Box key={tab.key} marginRight={2}>
            <Text
              bold={isActive}
              color={isActive ? 'cyan' : undefined}
              dimColor={!isActive}
            >
              {isActive ? '[' : ' '}
              {tab.shortcut}. {tab.label}
              {isActive ? ']' : ' '}
            </Text>
          </Box>
        );
      })}
      <Box flexGrow={1} />
      <Text dimColor>[r] refresh</Text>
      <Text dimColor>  [q] quit</Text>
    </Box>
  );
};

export default Tabs;


