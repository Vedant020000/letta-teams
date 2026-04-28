# letta-teams

CLI for orchestrating teams of stateful Letta agents working in parallel.

This is the terminal-facing package built on top of `letta-teams-sdk`.

## Install

```bash
npm install -g letta-teams
```

## What it does

Use `letta-teams` when you want to:

- spawn specialized teammates from the terminal
- dispatch work in parallel
- monitor tasks and teammate state
- run council sessions
- launch the interactive TUI dashboard
- install the bundled orchestration skill for agents

## Core commands

```bash
letta-teams daemon --start
letta-teams spawn backend "Backend engineer"
letta-teams message backend "Implement auth endpoints"
letta-teams tasks
letta-teams task <task-id> --wait
letta-teams --tui
```

## Relationship to the SDK

The CLI is intentionally thin.

It uses `letta-teams-sdk` for the reusable orchestration/runtime layer and adds:

- command parsing
- human-readable terminal output
- JSON output modes
- TUI/dashboard flows
- install/update ergonomics

If you want to embed Letta Teams inside another application instead of driving it from shell commands, use `letta-teams-sdk` directly.

## See also

- [../../README.md](../../README.md) - project overview
- [../letta-teams-sdk/README.md](../letta-teams-sdk/README.md) - SDK usage
