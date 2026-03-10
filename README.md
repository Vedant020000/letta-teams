# Letta Teams

**Give your agents a team to work with instead of having them do everything alone.**

[![npm version](https://img.shields.io/npm/v/letta-teams?style=flat-square&color=crimson&logo=npm)](https://www.npmjs.com/package/letta-teams) [![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=flat-square&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/vedant020000) [![GitHub issues](https://img.shields.io/github/issues/vedant020000/letta-teams?style=flat-square&color=red)](https://github.com/vedant020000/letta-teams/issues)


A CLI interface for Letta Code and LettaBot agents to orchestrate teams of stateful AI agents. Spawn specialized teammates, dispatch parallel tasks, and coordinate work across multiple agents with persistent memory.

## Overview

Letta Teams provides a command-line interface that AI agents can use to manage their own teams of specialized workers. Instead of a single agent handling every task, an agent can:

- **Spawn specialized teammates** with specific roles and capabilities
- **Dispatch parallel work** to multiple agents simultaneously
- **Track progress** across the team
- **Coordinate complex workflows** through delegation

```
┌─────────────────────────────────────────────────────────────────┐
│                     Your Letta Code Agent                       │
│                                                                 │
│   "I need to implement auth. Let me spawn a backend dev and     │
│    a test engineer to work in parallel."                        │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 │  letta-teams spawn backend "..."
                                 │  letta-teams dispatch backend="..." tests="..."
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Letta Teams CLI                            │
│                                                                 │
│   spawn • message • broadcast • dispatch • tasks • dashboard    │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                           Your Team                             │
│                                                                 │
│    ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│    │ Backend  │   │ Frontend │   │  Tests   │   │ Reviewer │    │ 
│    │   Dev    │   │   Dev    │   │          │   │          │    │
│    └──────────┘   └──────────┘   └──────────┘   └──────────┘    │
│                                                                 │
│   Each teammate has persistent memory, file operations,         │
│   shell execution, and web research capabilities.               │
└─────────────────────────────────────────────────────────────────┘
```

## Installation

```bash
npm install -g letta-teams
```

Agents can then invoke `letta-teams` commands via the Bash tool.

## Skill Integration

Load the skill file to give any Letta Code agent the ability to orchestrate teams:

```
@skills/letta-teams.md
```

The skill provides:
- Complete command reference with syntax and examples
- Workflow patterns for parallel execution and coordination
- Progress tracking and task management
- Best practices for role definition and delegation


## Core Concepts

### Teammates

A **teammate** is a stateful Letta agent with:
- Persistent memory (core + archival) that survives across sessions
- A unique name and specialized role
- File operations, shell execution, and web research tools
- No interactive prompts—they work autonomously

### Background Daemon

The CLI runs a background daemon that handles agent communication:
- Enables fire-and-forget messaging (dispatch tasks without blocking)
- Manages parallel execution across multiple teammates
- Tracks task state and results

### Task System

Every message creates a **task** with:
- Unique ID for tracking
- Status: pending → running → done/error
- Results and tool call history

## Key Commands

| Command | Purpose |
|---------|---------|
| `spawn <name> <role>` | Create a specialized teammate |
| `message <name> <prompt>` | Send a task to one teammate |
| `broadcast <prompt>` | Send the same task to all teammates |
| `dispatch A="..." B="..."` | Send different tasks to different teammates |
| `tasks` | List active tasks |
| `task <id>` | View task details and results |
| `dashboard` | See team activity and progress |
| `update-progress <name> ...` | Self-report progress (used by teammates) |

All messaging commands support `--wait` to block until completion.

## Example: Agent Orchestration

An agent implementing a feature might:

```bash
# 1. Spawn specialized teammates
letta-teams spawn api "Backend API developer specializing in REST"
letta-teams spawn ui "Frontend React developer"
letta-teams spawn tests "Test engineer who writes integration tests"

# 2. Dispatch parallel work
letta-teams dispatch api="Build user CRUD endpoints" ui="Build user management page" tests="Write integration tests for user features"

# 3. Monitor progress
letta-teams dashboard

# 4. Wait for specific tasks
letta-teams task <task-id> --wait

# 5. Synthesize results and continue
```


## Documentation

- **[skills/letta-teams/SKILL.md](skills/letta-teams/SKILL.md.)** — Full command reference for agents
- **[Letta Documentation](https://docs.letta.com)** — Platform documentation
- **[GitHub Issues](https://github.com/vedant020000/letta-teams/issues)** — Bug reports and feedback

## Support the Project

If you've scrolled this far and find Letta Teams useful, consider supporting its development! Building and maintaining open-source AI tools takes time, API credits, and a lot of coffee ☕

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=flat-square&logo=buy-me-a-coffee&logoColor=black)]

Your support helps keep projects like this free and open source. Thank you! 

## License

MIT
