import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  agentCount: number;
}

const Header: React.FC<HeaderProps> = ({ agentCount }) => {
  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      justifyContent="space-between"
    >
      <Box>
        <Text bold>Letta Teams Dashboard</Text>
      </Box>
      <Box>
        <Text dimColor>{agentCount} agents</Text>
      </Box>
    </Box>
  );
};

export default Header;


