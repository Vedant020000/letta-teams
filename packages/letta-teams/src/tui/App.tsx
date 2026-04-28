import React, { useState, useEffect, useCallback } from 'react';
import { Box, useApp, useInput, useStdout } from 'ink';
import Header from './components/Header.js';
import Tabs from './components/Tabs.js';
import Footer from './components/Footer.js';
import AgentList from './components/AgentList.js';
import AgentDetail from './components/AgentDetail.js';
import AgentDetailsTab from './components/AgentDetailsTab.js';
import TaskList from './components/TaskList.js';
import TaskDetail from './components/TaskDetail.js';
import ActivityFeed from './components/ActivityFeed.js';
import { useTeammates } from './hooks/useTeammates.js';
import { useTasks } from './hooks/useTasks.js';
import type { TeammateState, TaskState } from 'letta-teams-sdk/types';

type Tab = 'agents' | 'tasks' | 'activity' | 'details';

interface AppProps {
  includeInternal?: boolean;
}

const App: React.FC<AppProps> = ({ includeInternal = false }) => {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // State
  const [activeTab, setActiveTab] = useState<Tab>('agents');
  const [selectedAgentIndex, setSelectedAgentIndex] = useState(0);
  const [selectedTaskIndex, setSelectedTaskIndex] = useState(0);
  const [showInternal, setShowInternal] = useState(includeInternal);

  // Data hooks (with polling)
  const { teammates, refresh: refreshTeammates } = useTeammates(3000);
  const { tasks, refresh: refreshTasks } = useTasks(3000, showInternal);

  // Derived data
  const selectedAgent = teammates[selectedAgentIndex] || null;
  const sortedTasks = [...tasks].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const selectedTask = sortedTasks[selectedTaskIndex] || null;

  // Refresh all data
  const refreshAll = useCallback(() => {
    refreshTeammates();
    refreshTasks();
  }, [refreshTeammates, refreshTasks]);

  // Keyboard input
  useInput((input, key) => {
    // Tab switching
    if (input === '1') setActiveTab('agents');
    if (input === '2') setActiveTab('tasks');
    if (input === '3') setActiveTab('activity');
    if (input === '4') setActiveTab('details');

    // Tab key cycles through tabs
    if (key.tab) {
      setActiveTab(prev => {
        if (prev === 'agents') return 'tasks';
        if (prev === 'tasks') return 'activity';
        if (prev === 'activity') return 'details';
        return 'agents';
      });
    }

    // Navigation
    if (key.upArrow) {
      if (activeTab === 'agents') {
        setSelectedAgentIndex(prev => Math.max(0, prev - 1));
      } else if (activeTab === 'tasks') {
        setSelectedTaskIndex(prev => Math.max(0, prev - 1));
      }
    }

    if (key.downArrow) {
      if (activeTab === 'agents') {
        setSelectedAgentIndex(prev => Math.min(teammates.length - 1, prev + 1));
      } else if (activeTab === 'tasks') {
        setSelectedTaskIndex(prev => Math.min(sortedTasks.length - 1, prev + 1));
      }
    }

    // Left/Right for Details tab (horizontal agent selector)
    if (key.leftArrow && activeTab === 'details') {
      setSelectedAgentIndex(prev => Math.max(0, prev - 1));
    }

    if (key.rightArrow && activeTab === 'details') {
      setSelectedAgentIndex(prev => Math.min(teammates.length - 1, prev + 1));
    }

    // Refresh
    if (input === 'r') {
      refreshAll();
    }

    if (input === 'i') {
      setShowInternal(prev => !prev);
    }

    // Quit
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    }
  });

  // Reset selection when data changes
  useEffect(() => {
    if (selectedAgentIndex >= teammates.length) {
      setSelectedAgentIndex(Math.max(0, teammates.length - 1));
    }
  }, [teammates.length, selectedAgentIndex]);

  useEffect(() => {
    if (selectedTaskIndex >= sortedTasks.length) {
      setSelectedTaskIndex(Math.max(0, sortedTasks.length - 1));
    }
  }, [sortedTasks.length, selectedTaskIndex]);

  // Terminal height
  const height = stdout.rows || 24;

  return (
    <Box flexDirection="column" height={height}>
      {/* Header */}
      <Header agentCount={teammates.length} />

      {/* Tabs */}
      <Tabs activeTab={activeTab} />

      {/* Main content */}
      <Box flexGrow={1} flexDirection="column">
        {activeTab === 'agents' && (
          <>
            <AgentList
              teammates={teammates}
              selectedIndex={selectedAgentIndex}
            />
            <AgentDetail agent={selectedAgent} />
          </>
        )}

        {activeTab === 'tasks' && (
          <>
            <TaskList
              tasks={sortedTasks}
              selectedIndex={selectedTaskIndex}
              includeInternal={showInternal}
            />
            <TaskDetail task={selectedTask} />
          </>
        )}

        {activeTab === 'activity' && (
          <ActivityFeed tasks={sortedTasks} teammates={teammates} includeInternal={showInternal} />
        )}

        {activeTab === 'details' && (
          <AgentDetailsTab
            teammates={teammates}
            selectedIndex={selectedAgentIndex}
          />
        )}
      </Box>

      {/* Footer */}
      <Footer activeTab={activeTab} includeInternal={showInternal} />
    </Box>
  );
};

export default App;


