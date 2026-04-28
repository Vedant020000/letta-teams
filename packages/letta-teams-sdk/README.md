# letta-teams-sdk

Reusable SDK for orchestrating teams of stateful Letta agents.

This package contains the extracted runtime, storage layer, daemon/client bridges, and core orchestration APIs that power `letta-teams`.

## Install

```bash
npm install letta-teams-sdk
```

## Mental model

The SDK gives you a `TeamsRuntime` abstraction.

That runtime combines three pieces:

1. **Store** - filesystem-backed state for teammates and tasks
2. **Daemon orchestration** - background execution and coordination
3. **High-level runtime API** - teammate and task operations you can call from code

The main entrypoints are:

- `createTeamsRuntime()` - create a fresh runtime instance
- `getTeamsRuntime()` - get a shared singleton runtime

## Public runtime surface

### `runtime.daemon`

Use this to:

- start/check/stop the daemon
- ensure the daemon is running before orchestration
- inspect daemon status and log path

### `runtime.teammates`

Use this to:

- list teammates
- fetch teammate state
- check whether a teammate/target exists
- spawn new teammates
- fork conversation targets
- reinitialize teammate memory
- remove teammates

### `runtime.tasks`

Use this to:

- dispatch work to a teammate or target
- inspect task state
- list tasks
- wait for completion
- cancel a running task

## Example

```ts
import { createTeamsRuntime } from "letta-teams-sdk";

async function main() {
  const runtime = createTeamsRuntime();

  await runtime.daemon.ensureRunning();

  const backend = await runtime.teammates.spawn({
    name: "backend",
    role: "Backend engineer focused on auth and APIs",
  });

  const { taskId } = await runtime.tasks.dispatch({
    target: backend.name,
    message: "Implement the auth endpoints and summarize the result",
  });

  const task = await runtime.tasks.wait(taskId);
  console.log(task.status);
  console.log(task.result);
}

main().catch(console.error);
```

## How it works under the hood

Today, the SDK is the programmatic interface over the same runtime used by the CLI.

That means:

- teammate/task state is still persisted in the local Letta Teams store
- many high-level actions still go through the daemon client/runtime boundary
- the SDK keeps behavior aligned with the CLI instead of maintaining a separate execution engine

So if you are embedding this into Electron or another app, you are using the real Letta Teams orchestration stack directly - just through a code API instead of shell commands.

## Current exported surface

The package currently exports:

- runtime creation helpers
- runtime/domain errors
- shared types
- targets and task-visibility helpers

For lower-level modules, subpath exports are available, such as:

- `letta-teams-sdk/agent`
- `letta-teams-sdk/daemon`
- `letta-teams-sdk/ipc`
- `letta-teams-sdk/store`
- `letta-teams-sdk/types`

## See also

- [../../README.md](../../README.md) - project overview
- [../letta-teams/README.md](../letta-teams/README.md) - CLI package
