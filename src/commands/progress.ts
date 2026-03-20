import type { Command } from "commander";
import type { StatusPhase, TodoPriority, TodoState } from "../types.js";

import { validateName } from "../agent.js";
import {
  teammateExists,
  listTeammates,
  loadTeammate,
  updateStatusSummary,
  getRecentStatusEvents,
  findStaleTeammates,
  addTodo,
  listTodoItems,
  startTodo,
  blockTodo,
  unblockTodo,
  completeTodo,
  dropTodo,
} from "../store.js";
import { displayDashboard } from "../dashboard.js";

export function registerProgressCommands(program: Command): void {
  // STATUS COMMANDS
  const statusCommand = program
    .command('status')
    .description('STATUS channel commands');

  statusCommand
    .command('update <name>')
    .description('Update execution status summary and append status event')
    .requiredOption('--phase <phase>', 'idle|planning|implementing|testing|reviewing|blocked|done')
    .requiredOption('--message <text>', 'Status message')
    .option('--progress <number>', 'Progress percentage (0-100)')
    .option('--todo <id>', 'Current todo ID')
    .option('--files <csv>', 'Comma-separated list of files touched')
    .option('--tests <text>', 'Test command or summary')
    .option('--blocked-reason <text>', 'Blocker reason')
    .option('--code-change', 'Mark this as code-change milestone')
    .action((name: string, options) => {
      const globalOpts = program.opts();

      try {
        validateName(name);
      } catch (error) {
        handleError(error as Error, globalOpts.json);
        return;
      }

      if (!teammateExists(name)) {
        handleError(new Error(`Teammate '${name}' not found`), globalOpts.json);
        return;
      }

      const phase = options.phase as StatusPhase;
      const progress = options.progress ? parseInt(options.progress, 10) : undefined;
      const filesTouched = options.files
        ? String(options.files).split(',').map((f: string) => f.trim()).filter(Boolean)
        : undefined;

      const updated = updateStatusSummary(name, {
        phase,
        message: options.message,
        progress,
        currentTodoId: options.todo,
        filesTouched,
        testsRun: options.tests,
        blockedReason: options.blockedReason,
        codeChange: options.codeChange,
      });

      if (!updated) {
        handleError(new Error(`Failed to update status for '${name}'`), globalOpts.json);
        return;
      }

      if (globalOpts.json) {
        console.log(JSON.stringify(updated, null, 2));
      } else {
        console.log(`✓ Updated status for '${name}': ${phase} - ${options.message}`);
      }
    });

  statusCommand
    .command('events <name>')
    .description('Show recent STATUS events for a teammate')
    .option('--limit <n>', 'Number of events to show', '20')
    .action((name: string, options) => {
      const globalOpts = program.opts();
      const limit = parseInt(options.limit, 10);
      const events = getRecentStatusEvents(name, Number.isNaN(limit) ? 20 : limit);

      if (globalOpts.json) {
        console.log(JSON.stringify(events, null, 2));
        return;
      }

      if (events.length === 0) {
        console.log(`No status events for '${name}'`);
        return;
      }

      console.log(`Status events for ${name}:`);
      for (const event of events) {
        console.log(`- [${event.phase}/${event.type}] ${event.message} (${new Date(event.ts).toLocaleTimeString()})`);
      }
    });

  statusCommand
    .command('checkin [name]')
    .description('Show status summaries and stale teammates')
    .option('--stale <minutes>', 'Staleness threshold in minutes', '15')
    .option('--limit <n>', 'Events shown when name is provided', '10')
    .action((name: string | undefined, options) => {
      const globalOpts = program.opts();
      const staleMinutes = parseInt(options.stale, 10);
      const limit = parseInt(options.limit, 10);

      if (name) {
        const teammate = loadTeammate(name);
        if (!teammate) {
          handleError(new Error(`Teammate '${name}' not found`), globalOpts.json);
          return;
        }
        const events = getRecentStatusEvents(name, Number.isNaN(limit) ? 10 : limit);
        if (globalOpts.json) {
          console.log(JSON.stringify({ teammate, events }, null, 2));
        } else {
          console.log(`${teammate.name}: ${teammate.status}`);
          if (teammate.statusSummary) {
            console.log(`  ${teammate.statusSummary.phase} - ${teammate.statusSummary.message}`);
            console.log(`  heartbeat: ${teammate.statusSummary.lastHeartbeatAt}`);
          }
          if (events.length > 0) {
            console.log('  recent events:');
            for (const event of events) {
              console.log(`    - [${event.phase}] ${event.message}`);
            }
          }
        }
        return;
      }

      const teammates = listTeammates();
      const stale = new Set(findStaleTeammates(Number.isNaN(staleMinutes) ? 15 : staleMinutes).map((t) => t.name));

      if (globalOpts.json) {
        console.log(JSON.stringify({ teammates, stale: Array.from(stale) }, null, 2));
        return;
      }

      if (teammates.length === 0) {
        console.log('No teammates found.');
        return;
      }

      console.log('Team check-in:\n');
      for (const t of teammates) {
        const marker = stale.has(t.name) ? ' [STALE]' : '';
        const summary = t.statusSummary ? `${t.statusSummary.phase} - ${t.statusSummary.message}` : '-';
        console.log(`- ${t.name} (${t.status})${marker}`);
        console.log(`  ${summary}`);
      }
    });

  statusCommand.action(() => {
    console.log('Usage: status update|events|checkin ...');
  });

  // DASHBOARD COMMAND
  program
    .command("dashboard")
    .description("Show what's happening now - active work, recent activity, and idle teammates")
    .option("--limit <number>", "Number of recent items to show (default: 10)", "10")
    .option("--detail", "Show 2-line detail per item")
    .option("--verbose", "Show full task results instead of truncated")
    .option("--since <duration>", "Recent window: 30m, 6h, 2d, or minutes (default: 24h)", "24h")
    .option("--internal", "Include internal init/reinit tasks")
    .option("--json", "Output as JSON")
    .action((options) => {
      const globalOpts = program.opts();
      const jsonMode = globalOpts.json || options.json;
      const limit = parseInt(options.limit, 10);
      const detail = options.detail || false;
      const verbose = options.verbose || false;
      let sinceMinutes: number;
      try {
        sinceMinutes = parseDurationToMinutes(options.since);
      } catch (error) {
        handleError(error as Error, jsonMode);
        return;
      }

      displayDashboard({
        limit,
        detail,
        verbose,
        json: jsonMode,
        sinceMinutes,
        includeInternal: options.internal || false,
      });
    });

  // TODO COMMANDS
  const todoCommand = program
    .command('todo')
    .description('TODO channel commands');

  todoCommand
    .command('add <name> <title>')
    .description('Add a TODO item for a teammate')
    .option('--priority <level>', 'low|medium|high')
    .option('--notes <text>', 'Optional notes')
    .action((name: string, title: string, options) => {
      const globalOpts = program.opts();

      try {
        validateName(name);
      } catch (error) {
        handleError(error as Error, globalOpts.json);
        return;
      }

      if (!teammateExists(name)) {
        handleError(new Error(`Teammate '${name}' not found`), globalOpts.json);
        return;
      }

      const priority = options.priority as TodoPriority | undefined;
      const state = addTodo(name, { title, priority, notes: options.notes });

      if (globalOpts.json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log(`✓ Added todo for '${name}': ${title}`);
      }
    });

  todoCommand
    .command('list <name>')
    .description('List TODO items for a teammate')
    .option('--state <state>', 'pending|in_progress|blocked|done|dropped')
    .action((name: string, options) => {
      const globalOpts = program.opts();
      const items = listTodoItems(name);
      const filterState = options.state as TodoState | undefined;
      const filtered = filterState ? items.filter((item) => item.state === filterState) : items;

      if (globalOpts.json) {
        console.log(JSON.stringify(filtered, null, 2));
      } else {
        if (filtered.length === 0) {
          console.log(`No todo items for '${name}'`);
          return;
        }

        console.log(`Todo items for ${name}:`);
        for (const item of filtered) {
          const priority = item.priority ? ` [${item.priority}]` : '';
          console.log(`- ${item.id} (${item.state})${priority} ${item.title}`);
        }
      }
    });

  todoCommand
    .command('start <name> <todoId>')
    .description('Mark todo as in progress and set status to implementing')
    .option('--message <text>', 'Optional status message')
    .action((name: string, todoId: string, options) => {
      const globalOpts = program.opts();
      const state = startTodo(name, todoId, { message: options.message });

      if (globalOpts.json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log(`✓ Started todo '${todoId}' for '${name}'`);
      }
    });

  todoCommand
    .command('block <name> <todoId> <reason>')
    .description('Mark todo as blocked')
    .option('--message <text>', 'Optional status message')
    .action((name: string, todoId: string, reason: string, options) => {
      const globalOpts = program.opts();
      const state = blockTodo(name, todoId, reason, { message: options.message });

      if (globalOpts.json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log(`✓ Blocked todo '${todoId}' for '${name}'`);
      }
    });

  todoCommand
    .command('unblock <name> <todoId>')
    .description('Unblock todo and move to in_progress')
    .option('--message <text>', 'Optional status message')
    .action((name: string, todoId: string, options) => {
      const globalOpts = program.opts();
      const state = unblockTodo(name, todoId, { message: options.message });

      if (globalOpts.json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log(`✓ Unblocked todo '${todoId}' for '${name}'`);
      }
    });

  todoCommand
    .command('done <name> <todoId>')
    .description('Mark todo as done')
    .option('--message <text>', 'Optional status message')
    .action((name: string, todoId: string, options) => {
      const globalOpts = program.opts();
      const state = completeTodo(name, todoId, { message: options.message });

      if (globalOpts.json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log(`✓ Completed todo '${todoId}' for '${name}'`);
      }
    });

  todoCommand
    .command('drop <name> <todoId>')
    .description('Drop todo item')
    .option('--reason <text>', 'Optional reason')
    .action((name: string, todoId: string, options) => {
      const globalOpts = program.opts();
      const state = dropTodo(name, todoId, { reason: options.reason });

      if (globalOpts.json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        console.log(`✓ Dropped todo '${todoId}' for '${name}'`);
      }
    });

  todoCommand.action(() => {
    console.log('Usage: todo add|list|start|block|unblock|done|drop ...');
  });
}

function parseDurationToMinutes(input: string): number {
  const value = String(input).trim().toLowerCase();
  const match = value.match(/^(\d+)([mhd])?$/);
  if (!match) {
    throw new Error(`Invalid --since value '${input}'. Use formats like 30m, 6h, 2d, or raw minutes.`);
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2] || 'm';

  if (unit === 'm') return amount;
  if (unit === 'h') return amount * 60;
  return amount * 24 * 60;
}

function handleError(error: unknown, jsonMode: boolean): void {
  const message = error instanceof Error ? error.message : String(error);

  if (jsonMode) {
    console.error(JSON.stringify({ error: message }));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(1);
}
