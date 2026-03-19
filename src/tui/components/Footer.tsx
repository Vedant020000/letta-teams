import React from 'react';
import { Box, Text } from 'ink';

type Tab = 'agents' | 'tasks' | 'activity' | 'details';

interface FooterProps {
  activeTab: Tab;
  includeInternal?: boolean;
}

const Footer: React.FC<FooterProps> = ({ activeTab, includeInternal = false }) => {
  // Show different navigation hint based on tab
  const navHint = activeTab === 'details' ? '←→ navigate' : '↑↓ navigate';

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text dimColor>{navHint}</Text>
      <Text dimColor>  </Text>
      <Text dimColor>Tab switch</Text>
      <Text dimColor>  </Text>
      {activeTab === 'tasks' && (
        <>
          <Text dimColor>[x] cancel</Text>
          <Text dimColor>  </Text>
        </>
      )}
      <Text dimColor>[i] internal: {includeInternal ? 'on' : 'off'}</Text>
      <Text dimColor>  </Text>
      <Text dimColor>[r] refresh</Text>
      <Box flexGrow={1} />
      <Text dimColor>Ctrl+C exit</Text>
    </Box>
  );
};

export default Footer;
