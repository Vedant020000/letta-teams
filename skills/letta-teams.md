---
name: letta-teams
description: Orchestrate teams of stateful Letta agents. Spawn teammates, broadcast messages, dispatch different tasks, and coordinate parallel work across multiple AI agents.
---
# letta-teams: Multi-Agent Orchestration
`letta-teams` is a CLI for orchestrating teams of stateful Letta agents. It enables you to spawn multiple specialized agents, message them individually or in parallel, and monitor their progress through a dashboard.

## Quick Reference
```bash
# Authentication
letta-teams auth [api-key]              # Configure API key (prompts if not provided)
letta-teams auth --show                 # Check auth status
letta-teams auth --clear                # Clear stored token

# Daemon management
letta-teams daemon --start              # Start background daemon
letta-teams daemon --status             # Check daemon status
letta-teams daemon --stop               # Stop daemon

# Spawn teammates
letta-teams spawn <name> <role>         # Create a new teammate
letta-teams spawn <name> <role> --model <model>  # Use specific model
letta-teams spawn <name> <role> --force # Overwrite existing

# Message teammates
letta-teams message <name> <prompt>     # Send message (fire and forget)
letta-teams message <name> <prompt> -w  # Wait for completion
letta-teams message <name> <prompt> -wv # Wait + show tool calls
letta-teams broadcast <prompt>          # Send to all teammates
letta-teams broadcast <prompt> -w       # Broadcast and wait
letta-teams broadcast --to "A,B" <msg>  # Send to specific teammates
letta-teams dispatch A="task1" B="task2" # Different messages to different teammates
letta-teams dispatch A="task1" B="task2" -w  # Dispatch and wait

# Task management
letta-teams tasks                       # List all active tasks
letta-teams task <id>                   # View task details
letta-teams task <id> --wait            # Wait for task to complete
letta-teams task <id> --cancel          # Cancel a running task
letta-teams task <id> --verbose         # Show tool calls

# Monitor progress
letta-teams list                        # List all teammates
letta-teams status                      # Quick status summary
letta-teams dashboard                   # Show current activity
letta-teams dashboard --limit 20        # Show more items
letta-teams dashboard --verbose         # Show full task results
letta-teams info <name>                 # Detailed teammate info

# Model management
letta-teams model <name>                # Get teammate's model
letta-teams model <name> <model>        # Set teammate's model

# Progress tracking (used by agents to self-report)
letta-teams todo <name> <text>          # Update todo field
letta-teams work <name> <task>          # Set current work
letta-teams work <name> <task> --progress 50  # With progress %
letta-teams problem <name> <problem>    # Report a blocker
letta-teams clear-problem <name>        # Clear blocker
letta-teams update-progress <name> --task "..." --progress 50

# Cleanup
letta-teams prune                       # Clean up stale state
letta-teams prune --dry-run             # Preview what would be pruned
letta-teams remove <name>               # Remove from local config
letta-teams remove <name> --delete-agent # Also delete from Letta server

# Global options
--json                                  # Output as JSON
```

## Core Concepts

### Teammates
A **teammate** is a stateful Letta agent with:
- Persistent memory across sessions
- A name (unique identifier)
- A role (defines their specialty/behavior)
- Access to file operations, shell commands, web search, and memory tools

### Stateful Memory
Teammates remember conversations. Each teammate has:
- **Core memory** - Always in context (persona, human, project blocks)
- **Archival memory** - Searchable long-term storage
- **Conversation history** - Past messages in the current session

### Background Daemon
Letta Teams uses a background daemon process for handling agent communications:
- Starts automatically when needed
- Enables fire-and-forget messaging
- Handles parallel execution of tasks
- Tracks task state and progress

### Task System
When you send a message, it creates a **task**:
- Each task has a unique ID
- Tasks can be pending, running, done, or error
- Track tasks with `letta-teams tasks`
- View details with `letta-teams task <id>`

### The Lead Agent
The `lead` teammate is a convention for a coordinator agent:
```bash
letta-teams spawn lead "Coordinator who delegates work to other teammates"
```
Use the lead to delegate work to other teammates and synthesize results.

## Spawning Teammates

### Basic Spawn
```bash
letta-teams spawn developer "Software engineer who writes clean, tested code"
letta-teams spawn researcher "Research specialist who finds and summarizes information"
letta-teams spawn reviewer "Code reviewer who catches bugs and suggests improvements"
```

### Spawn Options
```bash
# Use a specific model
letta-teams spawn architect "System architect" --model claude-sonnet-4-20250514

# Overwrite existing teammate
letta-teams spawn dev "Developer" --force
```

### Role Guidelines
Good roles are specific and actionable:
- ✅ `"Python backend developer specializing in FastAPI"`
- ✅ `"QA engineer who writes Playwright tests"`
- ❌ `"Helpful assistant"` (too vague)
- ❌ `"Developer"` (too generic)

## Messaging Teammates

### Individual Messages
```bash
# Fire and forget (returns immediately with task ID)
letta-teams message developer "Implement user authentication with JWT tokens"

# Wait for completion
letta-teams message developer "Implement auth" --wait

# Wait and show tool calls
letta-teams message developer "Read package.json" --wait --verbose
```

Output with `--wait --verbose` shows tool calls:
```
  Read "package.json"
    ✓ Read 35 lines
[developer] Here's the package.json content...
```

### Broadcasting
Send the same message to all or specific teammates in parallel:

```bash
# Fire and forget to ALL teammates
letta-teams broadcast "Review the changes in src/auth.ts"

# Wait for all to complete
letta-teams broadcast "Review the changes" --wait

# Send to specific teammates
letta-teams broadcast --to "Alice,Bob" "Review this PR"

# Exclude specific teammates
letta-teams broadcast "Analyze this PR" --exclude lead,reviewer
```

### Dispatch (Different Messages)
Send different tasks to different teammates in parallel:

```bash
# Format: name=message or name:"message with spaces"
letta-teams dispatch Alice="review the backend code" Bob="review the frontend code"

# Wait for all to complete
letta-teams dispatch Alice="review backend" Bob="review frontend" --wait

# Assign different files to different teammates
letta-teams dispatch Alice="read src/auth.ts" Bob="read src/api.ts" Charlie="read src/db.ts"
```

### Message Content Tips
Be specific about what you want:
- ✅ `"Create a new file src/utils/date.ts with date formatting functions"`
- ❌ `"Do something with dates"`

Provide context when needed:
```bash
letta-teams message developer "The project uses TypeScript with strict mode. Create a new utility file for date formatting"
```

## Task Management

### Viewing Tasks
```bash
# List all active (pending/running) tasks
letta-teams tasks

# View specific task details
letta-teams task abc123

# Wait for a task to complete
letta-teams task abc123 --wait

# Show full result (no truncation)
letta-teams task abc123 --full

# Show tool calls made during execution
letta-teams task abc123 --verbose

# Cancel a running task
letta-teams task abc123 --cancel
```

### Task Output
```
Task: abc123
  Teammate: developer
  Status: done
  Created: 3/10/2026, 4:30:00 PM
  Started: 3/10/2026, 4:30:01 PM
  Completed: 3/10/2026, 4:30:45 PM

Message:
  Implement user authentication

Result:
  I've implemented JWT-based authentication...
```

## Progress Tracking

### Self-Reporting Progress
Teammates can report their own progress using the CLI:

```bash
# Update current task
letta-teams update-progress developer --task "Building authentication module"

# Update progress percentage
letta-teams update-progress developer --progress 50 --note "3 of 6 files done"

# Report a blocker
letta-teams update-progress developer --problem "Waiting for API documentation"

# Clear a problem
letta-teams update-progress developer --done

# Manage task queue
letta-teams update-progress developer --add-pending "Write tests"
letta-teams update-progress developer --complete-task "Write tests"
```

### Legacy Progress Commands
```bash
# Update todo field
letta-teams todo developer "Working on auth"

# Update work with progress
letta-teams work developer "Building auth" --progress 50 --note "3 of 6 files"

# Report/clear problems
letta-teams problem developer "Blocked on API docs"
letta-teams clear-problem developer
```

### Monitoring
```bash
# Quick status of all teammates
letta-teams status

# Dashboard showing current activity
letta-teams dashboard

# Dashboard with more items and full results
letta-teams dashboard --limit 20 --verbose

# Detailed info on specific teammate
letta-teams info developer
```

## Model Management

```bash
# Get current model
letta-teams model developer
# Output: developer: claude-sonnet-4-20250514

# Set model (updates both local config and Letta server)
letta-teams model developer claude-sonnet-4-20250514
```

## Cleanup

### Prune Command
Clean up stale state:

```bash
# Prune everything (default)
letta-teams prune

# Preview what would be pruned
letta-teams prune --dry-run

# Prune specific items
letta-teams prune --tasks              # Clear completed task history
letta-teams prune --agents             # Remove idle teammates
letta-teams prune --broken             # Remove teammates with no conversation ID

# Control age threshold
letta-teams prune --older-than 14      # Only items older than 14 days

# Skip confirmation
letta-teams prune -y
```

### Remove Teammates
```bash
# Only removes local config (agent still exists on server)
letta-teams remove dev

# Also deletes from Letta server (irreversible!)
letta-teams remove dev --delete-agent

# Skip confirmation
letta-teams remove dev --delete-agent -y
```

## Teammate Capabilities

Each spawned teammate has access to:

### File Operations
- `Read` - Read file contents
- `Write` - Create new files
- `Edit` - Modify existing files with string replacement
- `Glob` - Find files by pattern
- `Grep` - Search file contents

### Shell & Execution
- `Bash` - Execute shell commands
- `Task` - Spawn subagents for specialized tasks
- `TaskOutput` / `TaskStop` - Manage background tasks

### Web & Research
- `web_search` - Search the web (via Exa)
- `fetch_webpage` - Fetch and parse web content

### Memory Tools
- `core_memory_append` / `core_memory_replace` - Update core memory
- `archival_memory_insert` / `archival_memory_search` - Long-term storage
- `conversation_search` - Search conversation history

### Disabled Tools
Teammates CANNOT use:
- `AskUserQuestion` - No interactive prompts
- `EnterPlanMode` / `ExitPlanMode` - No planning mode

This ensures teammates execute tasks autonomously without blocking for user input.

## Gotchas & Common Issues

### API Key Priority
Environment variable takes priority over stored token:
1. `LETTA_API_KEY` env var (highest priority)
2. Stored token from `letta-teams auth`

```bash
# This will use env var even if you ran 'letta-teams auth'
LETTA_API_KEY=lta_xxx letta-teams spawn dev "Developer"
```

### Teammate Names
Names have restrictions:
- Max 64 characters
- Cannot contain: `< > : " / \ | ? *` or control characters
- Cannot be empty

Invalid names will throw an error before any API calls are made.

### Conversation ID Required
If a teammate has no `conversationId`, messaging will fail:
```
Error: Teammate 'name' has no conversation ID. Re-spawn the teammate.
```
This happens if spawning was interrupted. Re-spawn with `--force` to fix.

### Daemon Issues
If the daemon isn't responding:
```bash
# Check status
letta-teams daemon --status

# Stop and restart
letta-teams daemon --stop
letta-teams daemon --start
```

### Rate Limiting
If you see 429 errors:
1. Reduce number of concurrent broadcasts
2. Wait and retry (retry logic is built-in)
3. Space out API calls

### Corrupted State Files
If `.lteams/<name>.json` becomes corrupted:
- The teammate will be skipped in `list` and `status`
- A warning will be logged to console
- Delete the corrupted file and re-spawn if needed

### Terminal Dashboard
The dashboard requires a TTY terminal for best experience:
- Detects terminal width automatically
- Falls back gracefully on non-TTY (no ANSI colors)
- Use `--json` for non-interactive output:
  ```bash
  letta-teams dashboard --json
  ```

## Best Practices

### 1. Use Descriptive Roles
```bash
# Good - specific and actionable
letta-teams spawn backend "Python FastAPI developer who writes type-hinted code with comprehensive error handling"
letta-teams spawn frontend "React developer specializing in TypeScript and Tailwind CSS"

# Less effective - too vague
letta-teams spawn helper "Helpful coding assistant"
```

### 2. Use Fire-and-Forget for Parallel Work
```bash
# Dispatch multiple tasks without waiting
letta-teams dispatch api="build endpoints" ui="build components" tests="write tests"

# Check status later
letta-teams tasks
letta-teams dashboard
```

### 3. Use --wait for Sequential Dependencies
```bash
# Wait for first task to complete
letta-teams message dev "Create the database schema" --wait

# Then continue with next task
letta-teams message dev "Build the API on top of the schema" --wait
```

### 4. Use Progress Tracking
```bash
# See what everyone is working on
letta-teams status

# Then make informed decisions
letta-teams message dev "Since you're done with auth, start on the user profile feature"
```

### 5. Clean Up Unused Teammates
```bash
# List all teammates
letta-teams list

# Remove ones you don't need
letta-teams remove old-bot --delete-agent

# Or prune idle/broken teammates
letta-teams prune --dry-run
```

## Workflow Examples

### Code Review Team
```bash
# Spawn specialized reviewers
letta-teams spawn security "Security reviewer who checks for vulnerabilities"
letta-teams spawn style "Code style reviewer who enforces linting rules"
letta-teams spawn logic "Logic reviewer who checks for bugs and edge cases"

# Broadcast the review request and wait
letta-teams broadcast "Review src/auth/login.ts" --wait

# Check their findings
letta-teams status
```

### Parallel Feature Development
```bash
# Spawn developers for different parts
letta-teams spawn api "Backend API developer"
letta-teams spawn ui "Frontend UI developer"
letta-teams spawn tests "Test engineer"

# Dispatch parallel work (fire and forget)
letta-teams dispatch api="Create REST endpoints for user CRUD" ui="Create user management page" tests="Write integration tests"

# Monitor progress
letta-teams tasks
letta-teams dashboard
```

### Research Team
```bash
# Spawn researchers for different topics
letta-teams spawn research1 "Research specialist for authentication methods"
letta-teams spawn research2 "Research specialist for database optimization"
letta-teams spawn research3 "Research specialist for caching strategies"

# Broadcast research request and wait for results
letta-teams broadcast "Research best practices for your assigned topic. Summarize findings with code examples." --wait
```

## Troubleshooting

### "No API key found"
```bash
# Set via environment
export LETTA_API_KEY=lta_xxx

# Or configure interactively
letta-teams auth
```

### "Teammate 'x' not found"
```bash
# Check what teammates exist
letta-teams list

# Spawn if needed
letta-teams spawn x "Role description"
```

### "Failed to initialize teammate session"
This means the Letta API didn't return a conversation ID. The agent was created but session failed. Check:
1. API key is valid
2. Letta API is accessible
3. Try re-spawning with `--force`

### "Daemon failed to start"
```bash
# Check log file
cat ~/.lteams/daemon.log

# Try restarting
letta-teams daemon --stop
letta-teams daemon --start
```

### Rate Limiting
If you see 429 errors:
1. Reduce concurrent operations
2. Wait and retry (retry logic is built-in)
3. Space out API calls

### Dashboard Not Updating
- Check terminal supports ANSI codes
- Use `--json` for non-TTY environments
- Verify `.lteams/` directory exists and has valid JSON files
