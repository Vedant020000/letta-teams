#!/usr/bin/env node

/**
 * letta-teams CLI
 *
 * Orchestrate teams of stateful Letta agents working in parallel
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import dotenv from "dotenv";
import ora from "ora";
import Letta from "@letta-ai/letta-client";
import {
  ensureLteamsDir,
  getConversationTarget,
  listConversationTargets,
  teammateExists,
  targetExists,
  removeTeammate,
  listTeammates,
  loadTeammate,
  updateTeammate,
  getApiKey,
  addTodo,
  listTodoItems,
  startTodo,
  blockTodo,
  unblockTodo,
  completeTodo,
  dropTodo,
  updateStatusSummary,
  getRecentStatusEvents,
  findStaleTeammates,
  findTasksToPrune,
  findIdleTeammates,
  findBrokenTeammates,
  deleteTasks,
  deleteTeammates,
  getTask,
  updateTask,
  listTasks,
} from "./store.js";
import { checkApiKey, validateName } from "./agent.js";
import {
  startDaemon,
  stopDaemon,
  getDaemonPort,
} from "./daemon.js";
import {
  startDaemonInBackground,
  waitForDaemon,
  getDaemonLogPath,
  ensureDaemonRunning,
  dispatchTask,
  forkTeammateViaDaemon,
  waitForTask,
  spawnTeammateViaDaemon,
  reinitTeammateViaDaemon,
  isDaemonRunning,
} from "./ipc.js";
import { parseTargetName, validateTargetName } from './targets.js';
import { displayDashboard } from "./dashboard.js";
import { registerCommands } from "./commands/index.js";
import { launchTui } from "./tui/index.js";
import { checkAndAutoUpdate } from "./updater/auto-update.js";
import { startStartupAutoUpdateCheck } from "./updater/startup-auto-update.js";
import type { TaskState, TodoState, TodoPriority, StatusPhase } from "./types.js";

// Get version from package.json
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

// Load .env file from current working directory
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, quiet: true });
}

const program = new Command();

program
  .name("letta-teams")
  .description("CLI for orchestrating teams of stateful Letta agents")
  .version(packageJson.version);

// Global --json flag
program.option("--json", "Output as JSON instead of human-readable format");

// Global --tui flag for dashboard
program.option("--tui", "Launch interactive TUI dashboard");

registerCommands(program);

// ═══════════════════════════════════════════════════════════════
// DAEMON COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("daemon")
  .description("Manage the background daemon process")
  .option("--start", "Start the daemon in background")
  .option("--stop", "Stop the daemon")
  .option("--status", "Check daemon status")
  .option("--port <port>", "Port to listen on (default: 9774)", "9774")
  .option("--internal", "Internal flag for spawned daemon process")
  .action(async (options) => {
    const globalOpts = program.opts();

    // Internal flag: this is the actual daemon process (runs forever)
    if (options.internal) {
      const port = parseInt(options.port, 10);
      await startDaemon(port);
      return; // startDaemon runs forever
    }

    // Stop daemon
    if (options.stop) {
      const stopped = await stopDaemon();
      if (globalOpts.json) {
        console.log(JSON.stringify({ stopped }, null, 2));
      } else {
        if (stopped) {
          console.log("✓ Daemon stopped");
        } else {
          console.log("Daemon was not running");
        }
      }
      return;
    }

    // Check status
    if (options.status) {
      const running = isDaemonRunning();
      const port = getDaemonPort();
      if (globalOpts.json) {
        console.log(JSON.stringify({ running, port }, null, 2));
      } else {
        if (running) {
          console.log(`✓ Daemon is running on port ${port}`);
        } else {
          console.log("Daemon is not running");
        }
      }
      return;
    }

    // Start daemon in background (default or --start)
    if (options.start || (!options.stop && !options.status)) {
      if (isDaemonRunning()) {
        if (globalOpts.json) {
          console.log(JSON.stringify({ running: true, port: getDaemonPort() }, null, 2));
        } else {
          console.log(`Daemon is already running on port ${getDaemonPort()}`);
        }
        return;
      }

      // Check API key before spawning daemon (fail fast with clear error)
      try {
        checkApiKey();
      } catch (error) {
        handleError(error, globalOpts.json);
        return;
      }

      // Spawn daemon in background
      const pid = startDaemonInBackground();
      if (!pid) {
        handleError(new Error("Failed to spawn daemon process"), globalOpts.json);
        return;
      }

      // Wait for daemon to be ready (verifies it started successfully)
      const ready = await waitForDaemon(10000);
      if (ready) {
        if (globalOpts.json) {
          console.log(JSON.stringify({ started: true, pid }, null, 2));
        } else {
          console.log(`✓ Daemon started in background (PID: ${pid})`);
        }
      } else {
        // Daemon failed to start - show log file for debugging
        const logPath = getDaemonLogPath();
        handleError(
          new Error(`Daemon failed to start. Check log file: ${logPath}`),
          globalOpts.json
        );
      }
    }
  });

// ═══════════════════════════════════════════════════════════════
// SPAWN COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("spawn <name> <role>")
  .description("Create a teammate with a root conversation target and optional background memory init")
  .option("--model <model>", "Model to use (e.g. claude-sonnet-4-20250514, zai/glm-5)")
  .option("--spawn-prompt <text>", "Extra specialization prompt passed to background memory initialization")
  .option("--skip-init", "Skip background memory initialization entirely")
  .option("--no-memfs", "Disable memfs for this teammate")
  .option("--force", "Overwrite existing teammate with the same name")
  .addHelpText('after', `

Examples:
  $ letta-teams spawn backend "Backend engineer"
  $ letta-teams spawn backend "Backend engineer" --spawn-prompt "Focus on auth systems and migrations"
  $ letta-teams spawn backend "Backend engineer" --skip-init --no-memfs
`)
  .action(async (name: string, role: string, options) => {
    const globalOpts = program.opts();
    try {
      validateName(name);

      // Handle --force by removing existing teammate first
      if (options.force && teammateExists(name)) {
        removeTeammate(name);
      }

      if (teammateExists(name)) {
        handleError(new Error(`Teammate '${name}' already exists. Use --force to overwrite.`), globalOpts.json);
        return;
      }

      const spinner = globalOpts.json ? null : ora(`Spawning teammate '${name}'...`).start();

      // Ensure daemon is running (spawn uses createSession internally)
      await ensureDaemonRunning();

      // Spawn via daemon
      const state = await spawnTeammateViaDaemon(name, role, {
        model: options.model,
        spawnPrompt: options.spawnPrompt,
        skipInit: options.skipInit,
        memfsEnabled: !options.noMemfs,
      });

      if (globalOpts.json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        spinner!.succeed(`Spawned teammate '${name}'`);
        console.log(`  Agent ID: ${state.agentId}`);
        console.log(`  Role: ${state.role}`);
        if (state.model) console.log(`  Model: ${state.model}`);
        console.log(`  Memfs: ${state.memfsEnabled === false ? "disabled" : "enabled"}`);
        if (state.initStatus) console.log(`  Init: ${state.initStatus}`);
      }
    } catch (error) {
      handleError(error, globalOpts.json);
    }
  });

// ═══════════════════════════════════════════════════════════════
// REINIT COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("reinit <name>")
  .description("Re-run non-destructive background memory initialization for a teammate")
  .option("--prompt <text>", "Extra instructions for the reinit pass")
  .option("-w, --wait", "Wait for reinit to complete and show result")
  .addHelpText('after', `

Examples:
  $ letta-teams reinit backend
  $ letta-teams reinit backend --prompt "Refresh memory around the current auth architecture" --wait
`)
  .action(async (name: string, options) => {
    const globalOpts = program.opts();

    try {
      validateName(name);

      if (!teammateExists(name)) {
        handleError(new Error(`Teammate '${name}' not found`), globalOpts.json);
        return;
      }

      await ensureDaemonRunning();

      const taskId = await reinitTeammateViaDaemon(name, {
        prompt: options.prompt,
      });

      if (options.wait) {
        if (!globalOpts.json) {
          process.stdout.write(`[${name}] Reinitializing memory...\r`);
        }

        const task = await waitForTask(taskId);

        if (globalOpts.json) {
          console.log(JSON.stringify({ name, taskId, task }, null, 2));
        } else if (task.status === "error") {
          console.error(`[${name}] Error: ${task.error}`);
        } else {
          console.log(`[${name}] ${task.result || "(done)"}`);
        }
      } else if (globalOpts.json) {
        console.log(JSON.stringify({ name, taskId, status: "dispatched" }, null, 2));
      } else {
        console.log(`✓ Reinit started for '${name}' (task: ${taskId})`);
        console.log(`  Run 'letta-teams tasks' to see all, or 'letta-teams task ${taskId} --wait' to follow`);
      }
    } catch (error) {
      handleError(error, globalOpts.json);
    }
  });

// ═══════════════════════════════════════════════════════════════
// FORK COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command('fork <name> <forkName>')
  .description('Create a new conversation target like <name>/<forkName> on an existing teammate')
  .addHelpText('after', `

Examples:
  $ letta-teams fork backend review
  $ letta-teams message backend/review "Review the auth design"
`)
  .action(async (name: string, forkName: string) => {
    const globalOpts = program.opts();

    try {
      validateName(name);

      if (!teammateExists(name)) {
        handleError(new Error(`Teammate '${name}' not found`), globalOpts.json);
        return;
      }

      await ensureDaemonRunning();
      const state = await forkTeammateViaDaemon(name, forkName);
      const targetName = `${name}/${forkName}`;
      const target = state.targets?.find((entry) => entry.name === targetName);

      if (globalOpts.json) {
        console.log(JSON.stringify({ teammate: state, target }, null, 2));
      } else {
        console.log(`✓ Created fork '${targetName}'`);
        if (target?.conversationId) {
          console.log(`  Conversation ID: ${target.conversationId}`);
        }
      }
    } catch (error) {
      handleError(error, globalOpts.json);
    }
  });

// ═══════════════════════════════════════════════════════════════
// MESSAGE COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("message")
  .alias("msg")
  .description("Send a message to a root teammate target or fork target via the daemon")
  .argument("<name>", "Target name, e.g. backend or backend/review")
  .argument("[prompt...]", "Message to send (all remaining arguments joined together)")
  .option("-w, --wait", "Wait for task to complete and show result")
  .option("-v, --verbose", "Show tool calls and intermediate steps (requires --wait)")
  .addHelpText('after', `

Examples:
  $ letta-teams message backend "Implement OAuth login"
  $ letta-teams message backend/review "Review the OAuth design" --wait
`)
  .action(async (name: string, promptParts: string[], options) => {
    const globalOpts = program.opts();
    const prompt = promptParts.join(" ");

    if (!prompt) {
      handleError(new Error("Please provide a message to send"), globalOpts.json);
      return;
    }

    try {
      validateTargetName(name);

      // Check if target exists (fail fast)
      if (!targetExists(name)) {
        handleError(new Error(`Target '${name}' not found`), globalOpts.json);
        return;
      }

      // Ensure daemon is running
      await ensureDaemonRunning();

      // Dispatch task to daemon
      const { taskId } = await dispatchTask(name, prompt);

      if (options.wait) {
        // Wait for completion
        if (!globalOpts.json) {
          process.stdout.write(`[${name}] Working...\r`);
        }

        const task = await waitForTask(taskId);

        if (globalOpts.json) {
          console.log(JSON.stringify({ name, taskId, task }, null, 2));
        } else {
          if (task.status === "error") {
            console.error(`[${name}] Error: ${task.error}`);
          } else {
            console.log(`[${name}] ${task.result || "(done)"}`);
          }
        }
      } else {
        // Fire and forget
        if (globalOpts.json) {
          console.log(JSON.stringify({ name, taskId, status: "dispatched" }, null, 2));
        } else {
          console.log(`✓ Dispatched to '${name}' (task: ${taskId})`);
          console.log(`  Run 'letta-teams tasks' to see all, or 'letta-teams task ${taskId} --wait' to follow`);
        }
      }
    } catch (error) {
      handleError(error, globalOpts.json);
    }
  });

// ═══════════════════════════════════════════════════════════════
// BROADCAST COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("broadcast [promptParts...]")
  .description("Send a message to teammates or specific targets in parallel via daemon. Use --to for specific names, or omit to message all roots.")
  .option("--to <names>", "Comma-separated list of teammate or target names to message")
  .option("--exclude <names>", "Comma-separated list of teammate or target names to exclude")
  .option("-w, --wait", "Wait for all tasks to complete and show results")
  .addHelpText('after', `

Examples:
  $ letta-teams broadcast "Summarize current risks"
  $ letta-teams broadcast --to "backend,backend/review,tests" "Summarize current risks" --wait
`)
  .action(async (promptParts: string[], options) => {
    const globalOpts = program.opts();
    try {
      const exclude = options.exclude?.split(",").map((s: string) => s.trim()) || [];

      // Parse target names from --to option
      const targetNames = options.to
        ? options.to.split(",").map((s: string) => s.trim()).filter(Boolean)
        : undefined;

      const prompt = promptParts.join(" ");

      if (!prompt) {
        handleError(new Error("Please provide a message to broadcast"), globalOpts.json);
        return;
      }

      // Get list of teammates to message
      let targets = listTeammates().map((t) => t.name);
      if (targetNames && targetNames.length > 0) {
        for (const name of targetNames) {
          validateTargetName(name);
          if (!targetExists(name)) {
            handleError(new Error(`Target '${name}' not found`), globalOpts.json);
            return;
          }
        }
        targets = targetNames;
      }
      targets = targets.filter((target) => !exclude.includes(target));

      if (targets.length === 0) {
        handleError(new Error("No teammates to broadcast to"), globalOpts.json);
        return;
      }

      // Ensure daemon is running
      await ensureDaemonRunning();

      // Dispatch to all teammates
      const taskIds: { name: string; taskId: string }[] = [];

      for (const target of targets) {
        const { taskId } = await dispatchTask(target, prompt);
        taskIds.push({ name: target, taskId });
      }

      if (options.wait) {
        // Wait for all tasks to complete
        if (!globalOpts.json) {
          console.log(`Waiting for ${taskIds.length} teammates...\n`);
        }

        const results: Record<string, { taskId: string; status: string; result?: string; error?: string }> = {};

        for (const { name, taskId } of taskIds) {
          const task = await waitForTask(taskId);
          results[name] = {
            taskId,
            status: task.status,
            result: task.result,
            error: task.error,
          };
        }

        if (globalOpts.json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          for (const [name, result] of Object.entries(results)) {
            if (result.status === "error") {
              console.log(`\n[${name}] Error: ${result.error}`);
            } else {
              console.log(`\n[${name}]\n${result.result || "(done)"}`);
            }
          }
        }
      } else {
        // Fire and forget
        if (globalOpts.json) {
          console.log(JSON.stringify({
            dispatched: taskIds.length,
            tasks: taskIds,
          }, null, 2));
        } else {
          console.log(`✓ Dispatched to ${taskIds.length} teammates:`);
          for (const { name, taskId } of taskIds) {
            console.log(`  ${name}: ${taskId}`);
          }
          console.log(`\nRun 'letta-teams tasks' to see all active`);
        }
      }
    } catch (error) {
      handleError(error, globalOpts.json);
    }
  });

// ═══════════════════════════════════════════════════════════════
// DISPATCH COMMAND - Different messages to different teammates
// ═══════════════════════════════════════════════════════════════

program
  .command("dispatch [assignments...]")
  .description("Send different messages to different teammate or fork targets via daemon")
  .option("-w, --wait", "Wait for all tasks to complete and show results")
  .addHelpText('after', `

Assignment formats:
  target=message
  target:"message with spaces"

Examples:
  $ letta-teams dispatch backend="Implement OAuth" tests="Add coverage"
  $ letta-teams dispatch backend="Implement OAuth" backend/review="Review OAuth design" --wait
`)
  .action(async (assignments: string[], options) => {
    const globalOpts = program.opts();
    try {
      // Parse assignments: name=message or name:"message" pairs
      const messages = new Map<string, string>();

      for (const arg of assignments) {
        // Try name:"message" format first
        const quotedMatch = arg.match(/^([^:=]+):"(.+)"$/);
        if (quotedMatch) {
          const [, name, message] = quotedMatch;
          messages.set(name, message);
          continue;
        }

        // Try name=message format
        const eqMatch = arg.match(/^([^=]+)=(.+)$/);
        if (eqMatch) {
          const [, name, message] = eqMatch;
          messages.set(name, message);
          continue;
        }

        // Try name:message format (colon without quotes)
        const colonMatch = arg.match(/^([^:]+):(.+)$/);
        if (colonMatch) {
          const [, name, message] = colonMatch;
          messages.set(name, message);
          continue;
        }
      }

      if (messages.size === 0) {
        handleError(new Error('Please provide assignments in format: name=message or name:"message"'), globalOpts.json);
        return;
      }

      // Ensure daemon is running
      await ensureDaemonRunning();

      // Dispatch to all teammates
      const taskIds: { name: string; taskId: string }[] = [];

      for (const [name, message] of messages) {
        validateTargetName(name);
        if (!targetExists(name)) {
          throw new Error(`Target '${name}' not found`);
        }
        const { taskId } = await dispatchTask(name, message);
        taskIds.push({ name, taskId });
      }

      if (options.wait) {
        // Wait for all tasks to complete
        if (!globalOpts.json) {
          console.log(`Waiting for ${taskIds.length} teammates...\n`);
        }

        const results: Record<string, { taskId: string; status: string; result?: string; error?: string }> = {};

        for (const { name, taskId } of taskIds) {
          const task = await waitForTask(taskId);
          results[name] = {
            taskId,
            status: task.status,
            result: task.result,
            error: task.error,
          };
        }

        if (globalOpts.json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          for (const [name, result] of Object.entries(results)) {
            if (result.status === "error") {
              console.log(`\n[${name}] Error: ${result.error}`);
            } else {
              console.log(`\n[${name}]\n${result.result || "(done)"}`);
            }
          }
        }
      } else {
        // Fire and forget
        if (globalOpts.json) {
          console.log(JSON.stringify({
            dispatched: taskIds.length,
            tasks: taskIds,
          }, null, 2));
        } else {
          console.log(`✓ Dispatched to ${taskIds.length} teammates:`);
          for (const { name, taskId } of taskIds) {
            console.log(`  ${name}: ${taskId}`);
          }
          console.log(`\nRun 'letta-teams tasks' to see all active`);
        }
      }
    } catch (error) {
      handleError(error, globalOpts.json);
    }
  });

// ═══════════════════════════════════════════════════════════════
// PRUNE COMMAND - Clean up stale state
// ═══════════════════════════════════════════════════════════════

program
  .command("prune")
  .description("Clean up stale state - old tasks, idle agents, broken teammates")
  .option("--tasks", "Clear completed task history")
  .option("--agents", "Remove idle teammates (no activity in N days)")
  .option("--broken", "Remove teammates with no conversation ID")
  .option("--all", "Prune everything (tasks, agents, broken)")
  .option("--older-than <days>", "Only prune items older than N days (default: 7)", "7")
  .option("--dry-run", "Show what would be pruned without doing it")
  .option("-y, --yes", "Skip confirmation prompt")
  .action((options) => {
    const globalOpts = program.opts();
    const daysOld = parseInt(options.olderThan, 10) || 7;

    // Default: prune everything if no specific flags
    const pruneAll = options.all || (!options.tasks && !options.agents && !options.broken);
    const pruneTasks = pruneAll || options.tasks;
    const pruneAgents = pruneAll || options.agents;
    const pruneBroken = pruneAll || options.broken;

    // Find items to prune
    const tasksToPrune = pruneTasks ? findTasksToPrune(daysOld) : [];
    const idleAgents = pruneAgents ? findIdleTeammates(daysOld) : [];
    const brokenAgents = pruneBroken ? findBrokenTeammates() : [];

    // Filter out broken agents from idle list (avoid double-counting)
    const brokenNames = new Set(brokenAgents.map((a) => a.name));
    const idleOnly = idleAgents.filter((a) => !brokenNames.has(a.name));

    const totalItems = tasksToPrune.length + idleOnly.length + brokenAgents.length;

    if (totalItems === 0) {
      console.log("Nothing to prune - everything is clean!");
      return;
    }

    // Show what would be pruned
    if (tasksToPrune.length > 0) {
      console.log(`Tasks to clear: ${tasksToPrune.length} completed`);
    }
    if (idleOnly.length > 0) {
      const names = idleOnly.map((a) => a.name).join(", ");
      console.log(`Agents to remove: ${idleOnly.length} idle (${names})`);
    }
    if (brokenAgents.length > 0) {
      const names = brokenAgents.map((a) => a.name).join(", ");
      console.log(`Broken agents: ${brokenAgents.length} (${names} - no conversation ID)`);
    }

    // Dry run - just show and exit
    if (options.dryRun) {
      console.log("\n(dry run - no changes made)");
      return;
    }

    // Confirm unless --yes
    if (!options.yes) {
      const readline = require("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question("\nContinue? [y/N] ", (answer: string) => {
        rl.close();
        if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
          doPrune();
        } else {
          console.log("Cancelled.");
        }
      });
      return;
    }

    doPrune();

    function doPrune() {
      let tasksDeleted = 0;
      let agentsDeleted = 0;

      if (tasksToPrune.length > 0) {
        tasksDeleted = deleteTasks(tasksToPrune.map((t) => t.id));
      }

      const agentsToDelete = [...idleOnly, ...brokenAgents];
      if (agentsToDelete.length > 0) {
        agentsDeleted = deleteTeammates(agentsToDelete.map((a) => a.name));
      }

      console.log(`✓ Pruned ${tasksDeleted} tasks, ${agentsDeleted} agents`);
    }
  });

// ═══════════════════════════════════════════════════════════════
// LIST COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("list")
  .description("List all teammates and any fork targets stored on them")
  .action(() => {
    const globalOpts = program.opts();
    const teammates = listTeammates();

    if (globalOpts.json) {
      console.log(JSON.stringify(teammates, null, 2));
    } else {
      if (teammates.length === 0) {
        console.log("No teammates found. Use 'spawn <name>' to create one.");
        return;
      }

      console.log("Teammates:\n");
      for (const t of teammates) {
        const rootTarget = t.targets?.find(target => target.kind === 'root');
        console.log(`  ${t.name}`);
        if (rootTarget?.conversationId) {
          console.log(`    Conversation: ${rootTarget.conversationId}`);
        }
        if (t.model) console.log(`    Model: ${t.model}`);
        console.log(`    Status: ${t.status}`);
        const forks = listConversationTargets(t.name).filter((target) => target.name !== t.name);
        if (forks.length > 0) {
          console.log(`    Targets:`);
          for (const fork of forks) {
            const convId = fork.conversationId ? ` (${fork.conversationId.slice(0, 12)}...)` : '';
            console.log(`      - ${fork.name}${convId}`);
          }
        }
        if (t.statusSummary?.message) console.log(`    Status: ${t.statusSummary.message}`);
        if (t.todoItems && t.todoItems.length > 0) {
          const active = t.todoItems.filter((item) => item.state === 'in_progress' || item.state === 'blocked');
          console.log(`    Todos: ${t.todoItems.length} total (${active.length} active)`);
        }
        console.log(`    Last updated: ${t.lastUpdated}`);
        console.log();
      }
    }
  });

// ═══════════════════════════════════════════════════════════════
// MODEL COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("model <name> [model]")
  .description("Get or set a teammate's model")
  .option("--json", "Output as JSON")
  .action(async (name: string, model: string | undefined, options) => {
    const globalOpts = program.opts();
    const jsonMode = globalOpts.json || options.json;

    try {
      validateName(name);
    } catch (error) {
      handleError(error as Error, globalOpts.json);
      return;
    }

    const state = loadTeammate(name);
    if (!state) {
      handleError(new Error(`Teammate '${name}' not found`), jsonMode);
      return;
    }

    // No model provided - show current
    if (!model) {
      if (jsonMode) {
        console.log(JSON.stringify({ name, model: state.model || null }, null, 2));
      } else {
        if (state.model) {
          console.log(`${name}: ${state.model}`);
        } else {
          console.log(`${name}: (default)`);
        }
      }
      return;
    }

    // Update model via Letta API
    const spinner = jsonMode ? null : ora(`Updating '${name}' model...`).start();

    try {
      const apiKey = getApiKey();
      if (!apiKey) {
        throw new Error("LETTA_API_KEY not configured");
      }

      const client = new Letta({ apiKey });
      await client.agents.update(state.agentId, { model });

      // Update local JSON
      const updated = updateTeammate(name, { model });

      if (jsonMode) {
        console.log(JSON.stringify(updated, null, 2));
      } else {
        spinner!.succeed(`Updated '${name}' model: ${state.model || "(default)"} → ${model}`);
      }
    } catch (error) {
      if (spinner) spinner.fail("Failed to update model");
      handleError(error as Error, jsonMode);
    }
  });

// ═══════════════════════════════════════════════════════════════
// INFO COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("info <name>")
  .description("Show detailed info about a teammate or target")
  .addHelpText('after', `

Examples:
  $ letta-teams info backend
  $ letta-teams info backend/review
`)
  .action((name: string) => {
    const globalOpts = program.opts();
    try {
      validateTargetName(name);
    } catch (error) {
      handleError(error as Error, globalOpts.json);
      return;
    }

    const parsed = parseTargetName(name);
    const state = loadTeammate(parsed.rootName);

    if (!state) {
      handleError(new Error(`Teammate '${parsed.rootName}' not found`), globalOpts.json);
      return;
    }

    const target = getConversationTarget(parsed.rootName, parsed.fullName);
    if (!target) {
      handleError(new Error(`Target '${parsed.fullName}' not found`), globalOpts.json);
      return;
    }

    if (globalOpts.json) {
      console.log(JSON.stringify({ teammate: state, target }, null, 2));
    } else {
      const memfsStatus = state.memfsEnabled === false
        ? 'disabled'
        : state.memfsLastSyncedAt
          ? `enabled (last synced: ${state.memfsLastSyncedAt})`
          : 'enabled';

      console.log(`Target: ${target.name}`);
      console.log(`  Root teammate: ${state.name}`);
      console.log(`  Agent ID: ${state.agentId}`);
      if (target.conversationId) {
        console.log(`  Conversation ID: ${target.conversationId}`);
      }
      console.log(`  Kind: ${target.kind}`);
      if (state.model) console.log(`  Model: ${state.model}`);
      console.log(`  Memfs status: ${memfsStatus}`);
      console.log(`  Status: ${target.status ?? state.status}`);
      if (target.parentTargetName) console.log(`  Parent target: ${target.parentTargetName}`);
      if (state.statusSummary?.message) {
        console.log(`  Status summary: ${state.statusSummary.phase} - ${state.statusSummary.message}`);
      }
      if (state.todoItems && state.todoItems.length > 0) {
        console.log(`  Todo items: ${state.todoItems.length}`);
      }
      console.log(`  Created: ${target.createdAt}`);
      console.log(`  Last active: ${target.lastActiveAt}`);
    }
  });

// ═══════════════════════════════════════════════════════════════
// REMOVE COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("remove <name>")
  .description("Remove a teammate from local configuration")
  .option("--delete-agent", "Also delete the Letta agent from the server")
  .option("-y, --yes", "Skip confirmation prompt when deleting agent")
  .action(async (name: string, options) => {
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

    const state = loadTeammate(name);
    let agentDeleted = false;

    // Delete agent from server if requested
    if (options.deleteAgent && state?.agentId) {
      // Require confirmation unless --yes is provided
      if (!options.yes && !globalOpts.json) {
        const readline = await import("node:readline/promises");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await rl.question(
          `This will permanently delete the Letta agent '${name}' (ID: ${state.agentId}) from the server. Continue? [y/N] `
        );
        rl.close();
        if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
          console.log("Cancelled.");
          return;
        }
      }

      try {
        const Letta = (await import("@letta-ai/letta-client")).default;
        const client = new Letta({ apiKey: process.env.LETTA_API_KEY });
        await client.agents.delete(state.agentId);
        agentDeleted = true;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (!globalOpts.json) {
          console.warn(`  Warning: Failed to delete agent from server: ${errorMsg}`);
        }
      }
    }

    removeTeammate(name);

    if (globalOpts.json) {
      console.log(JSON.stringify({ name, removed: true, agentDeleted }, null, 2));
    } else {
      console.log(`✓ Removed teammate '${name}'`);
      if (options.deleteAgent) {
        if (agentDeleted) {
          console.log("  The Letta agent has been deleted from the server");
        } else {
          console.log("  Note: Failed to delete the Letta agent from the server");
        }
      } else {
        console.log("  Note: The Letta agent still exists on the server (use --delete-agent to remove)");
      }
    }
  });

// ═══════════════════════════════════════════════════════════════
// STATUS COMMANDS
// ═══════════════════════════════════════════════════════════════

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
      ? String(options.files).split(',').map((f) => f.trim()).filter(Boolean)
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

// ═══════════════════════════════════════════════════════════════
// DASHBOARD COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("dashboard")
  .description("Show what's happening now - active work, recent activity, and idle teammates")
  .option("--limit <number>", "Number of recent items to show (default: 10)", "10")
  .option("--detail", "Show 2-line detail per item")
  .option("--verbose", "Show full task results instead of truncated")
  .option("--since <duration>", "Recent window: 30m, 6h, 2d, or minutes (default: 24h)", "24h")
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
    });
  });

// ═══════════════════════════════════════════════════════════════
// TASKS COMMAND - Show all active tasks
// ═══════════════════════════════════════════════════════════════

program
  .command("tasks")
  .description("Show all active tasks (running/pending), including routed fork targets")
  .option("--json", "Output as JSON")
  .action((options) => {
    const globalOpts = program.opts();
    const jsonMode = globalOpts.json || options.json;

    const allTasks = listTasks();
    const activeTasks = allTasks.filter(t => t.status === "pending" || t.status === "running");

    if (jsonMode) {
      console.log(JSON.stringify(activeTasks, null, 2));
      return;
    }

    if (activeTasks.length === 0) {
      console.log("No active tasks");
      return;
    }

    console.log("Active Tasks:");
    console.log("─".repeat(70));

    for (const task of activeTasks) {
      const statusIcon = task.status === "running" ? "●" : "○";
      const elapsed = task.startedAt
        ? Math.round((Date.now() - new Date(task.startedAt).getTime()) / 1000) + "s"
        : "-";
      console.log(`${statusIcon} ${task.teammateName.padEnd(12)} ${task.id.padEnd(24)} ${task.status.padEnd(8)} ${elapsed}`);
    }
  });

// ═══════════════════════════════════════════════════════════════
// WATCH COMMAND - Stream task updates continuously
// ═══════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearScreenIfTty(): void {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1Bc");
  }
}

function isActiveTask(task: TaskState): boolean {
  return task.status === "pending" || task.status === "running";
}

function formatElapsed(task: TaskState): string {
  if (!task.startedAt) {
    return "-";
  }
  return `${Math.round((Date.now() - new Date(task.startedAt).getTime()) / 1000)}s`;
}

function matchesWatchTarget(task: TaskState, targetName: string): boolean {
  return (
    task.teammateName === targetName ||
    task.targetName === targetName ||
    task.rootTeammateName === targetName
  );
}

program
  .command("watch [target]")
  .description("Watch task updates continuously (all tasks, a specific task ID, or teammate/target)")
  .option("--interval <ms>", "Polling interval in milliseconds (default: 1000)", "1000")
  .option("--json", "Stream snapshots as JSON")
  .addHelpText('after', `

Examples:
  $ letta-teams watch
  $ letta-teams watch backend
  $ letta-teams watch backend/review
  $ letta-teams watch task_abc123
`)
  .action(async (target: string | undefined, options) => {
    const globalOpts = program.opts();
    const jsonMode = globalOpts.json || options.json;

    const intervalMs = parseInt(options.interval, 10);
    if (Number.isNaN(intervalMs) || intervalMs < 200) {
      handleError(new Error("--interval must be a number >= 200"), jsonMode);
      return;
    }

    let watchMode: "all" | "task" | "target" = "all";
    let watchedTaskId: string | null = null;
    let watchedTargetName: string | null = null;

    if (target) {
      const task = getTask(target);
      if (task) {
        watchMode = "task";
        watchedTaskId = target;
      } else if (targetExists(target) || teammateExists(target)) {
        watchMode = "target";
        watchedTargetName = target;
      } else {
        handleError(
          new Error(`'${target}' is neither a known task ID nor a known teammate/target`),
          jsonMode,
        );
        return;
      }
    }

    let stopped = false;
    process.once("SIGINT", () => {
      stopped = true;
      if (!jsonMode) {
        console.log("\nStopped watch.");
      }
    });

    while (!stopped) {
      const nowIso = new Date().toISOString();

      if (watchMode === "task" && watchedTaskId) {
        const task = getTask(watchedTaskId);
        if (!task) {
          handleError(new Error(`Task '${watchedTaskId}' not found`), jsonMode);
          return;
        }

        if (jsonMode) {
          console.log(JSON.stringify({ watchedTaskId, timestamp: nowIso, task }, null, 2));
        } else {
          clearScreenIfTty();
          console.log(`Watching task ${task.id} (Ctrl+C to stop)`);
          console.log("─".repeat(70));
          console.log(`Target:    ${task.targetName || task.teammateName}`);
          console.log(`Status:    ${task.status}`);
          console.log(`Created:   ${new Date(task.createdAt).toLocaleString()}`);
          if (task.startedAt) {
            console.log(`Started:   ${new Date(task.startedAt).toLocaleString()}`);
          }
          if (task.completedAt) {
            console.log(`Completed: ${new Date(task.completedAt).toLocaleString()}`);
          }
          console.log(`Elapsed:   ${formatElapsed(task)}`);
          console.log();
          console.log("Message:");
          console.log(`  ${task.message}`);

          if (task.result) {
            const lines = task.result.split("\n").slice(0, 10);
            console.log();
            console.log("Result (first 10 lines):");
            for (const line of lines) {
              console.log(`  ${line}`);
            }
          }

          if (task.error) {
            console.log();
            console.log("Error:");
            for (const line of task.error.split("\n").slice(0, 10)) {
              console.log(`  ${line}`);
            }
          }
        }

        if (!isActiveTask(task)) {
          if (!jsonMode) {
            console.log("\nTask finished. Exiting watch.");
          }
          return;
        }
      } else {
        const allTasks = listTasks();
        const filteredTasks = watchedTargetName
          ? allTasks.filter((task) => matchesWatchTarget(task, watchedTargetName!))
          : allTasks;

        const activeTasks = filteredTasks
          .filter(isActiveTask)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const recentCompleted = filteredTasks
          .filter((task) => task.status === "done" || task.status === "error")
          .sort((a, b) => {
            const aTime = a.completedAt ? new Date(a.completedAt).getTime() : new Date(a.createdAt).getTime();
            const bTime = b.completedAt ? new Date(b.completedAt).getTime() : new Date(b.createdAt).getTime();
            return bTime - aTime;
          })
          .slice(0, 10);

        if (jsonMode) {
          console.log(JSON.stringify({
            mode: watchMode,
            target: watchedTargetName,
            timestamp: nowIso,
            activeTasks,
            recentCompleted,
          }, null, 2));
        } else {
          clearScreenIfTty();
          const label = watchedTargetName ? `target '${watchedTargetName}'` : "all tasks";
          console.log(`Watching ${label} (Ctrl+C to stop)`);
          console.log(`Updated: ${new Date(nowIso).toLocaleTimeString()}`);
          console.log();

          if (activeTasks.length === 0) {
            console.log("No active tasks");
          } else {
            console.log("Active Tasks:");
            console.log("─".repeat(90));
            for (const task of activeTasks) {
              const statusIcon = task.status === "running" ? "●" : "○";
              const targetLabel = task.targetName || task.teammateName;
              console.log(
                `${statusIcon} ${targetLabel.padEnd(20)} ${task.id.padEnd(24)} ${task.status.padEnd(8)} ${formatElapsed(task)}`,
              );
            }
          }

          if (recentCompleted.length > 0) {
            console.log();
            console.log("Recent Completed (last 10):");
            console.log("─".repeat(90));
            for (const task of recentCompleted) {
              const icon = task.status === "done" ? "✓" : "✗";
              const targetLabel = task.targetName || task.teammateName;
              const when = task.completedAt ? new Date(task.completedAt).toLocaleTimeString() : "-";
              console.log(`${icon} ${targetLabel.padEnd(20)} ${task.id.padEnd(24)} ${task.status.padEnd(8)} ${when}`);
            }
          }
        }
      }

      await sleep(intervalMs);
    }
  });

// ═══════════════════════════════════════════════════════════════
// TASK COMMAND - View specific task details
// ═══════════════════════════════════════════════════════════════

program
  .command("task <id>")
  .description("Show details of a specific task, including its routed target when available")
  .option("--json", "Output as JSON")
  .option("--wait", "Poll until task completes")
  .option("--full", "Show full result (no truncation)")
  .option("--cancel", "Cancel a running task")
  .option("--verbose", "Show tool calls made during execution")
  .action(async (id: string, options) => {
    const globalOpts = program.opts();
    const jsonMode = globalOpts.json || options.json;

    // Handle --cancel flag
    if (options.cancel) {
      const task = getTask(id);
      if (!task) {
        handleError(new Error(`Task '${id}' not found`), jsonMode);
        return;
      }
      if (task.status !== "pending" && task.status !== "running") {
        console.log(`Task ${id} is already ${task.status}`);
        return;
      }
      updateTask(id, {
        status: "error",
        error: "Cancelled by user",
        completedAt: new Date().toISOString()
      });
      console.log(`✓ Cancelled task ${id}`);
      return;
    }

    // Handle --wait flag
    if (options.wait) {
      let task = getTask(id);
      if (!task) {
        handleError(new Error(`Task '${id}' not found`), jsonMode);
        return;
      }

      process.stdout.write(`Waiting for task ${id}...`);
      while (task && (task.status === "pending" || task.status === "running")) {
        process.stdout.write(".");
        await new Promise(r => setTimeout(r, 1000));
        task = getTask(id);
      }
      console.log();

      if (!task) {
        handleError(new Error(`Task '${id}' disappeared`), jsonMode);
        return;
      }
    }

    const task = getTask(id);
    if (!task) {
      handleError(new Error(`Task '${id}' not found`), jsonMode);
      return;
    }

    if (jsonMode) {
      console.log(JSON.stringify(task, null, 2));
      return;
    }

    console.log(`Task: ${task.id}`);
    console.log(`  Teammate: ${task.teammateName}`);
    console.log(`  Status: ${task.status}`);
    console.log(`  Created: ${new Date(task.createdAt).toLocaleString()}`);
    if (task.startedAt) {
      console.log(`  Started: ${new Date(task.startedAt).toLocaleString()}`);
    }
    if (task.completedAt) {
      console.log(`  Completed: ${new Date(task.completedAt).toLocaleString()}`);
    }
    console.log();
    console.log(`Message:`);
    console.log(`  ${task.message}`);

    // Show tool calls if verbose or if result is empty
    if (task.toolCalls && task.toolCalls.length > 0 && (options.verbose || !task.result)) {
      console.log();
      console.log(`Tool Calls:`);
      for (const tc of task.toolCalls) {
        const icon = tc.success ? "✓" : "✗";
        const input = tc.input ? ` "${tc.input}"` : "";
        if (tc.success) {
          console.log(`  ${icon} ${tc.name}${input}`);
        } else {
          console.log(`  ${icon} ${tc.name}${input} (${tc.error || "failed"})`);
        }
      }
    }

    console.log();
    if (task.result) {
      const lines = task.result.split("\n");
      const maxLines = options.full ? lines.length : 20;
      const truncated = lines.length > maxLines;

      console.log(`Result:`);
      for (const line of lines.slice(0, maxLines)) {
        console.log(`  ${line}`);
      }
      if (truncated) {
        console.log(`  ... (${lines.length - maxLines} more lines, run with --full to see all)`);
      }
    } else if (task.status === "done") {
      console.log(`Result:`);
      console.log(`  (no output)`);
    }
    if (task.error) {
      console.log();
      console.log(`Error:`);
      for (const line of task.error.split("\n")) {
        console.log(`  ${line}`);
      }
    }
  });

// ═══════════════════════════════════════════════════════════════
// TODO COMMANDS
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════

function handleError(error: unknown, jsonMode: boolean): void {
  const message = error instanceof Error ? error.message : String(error);

  if (jsonMode) {
    console.error(JSON.stringify({ error: message }));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

// Ensure .lteams directory exists on startup
ensureLteamsDir();

// Start background auto-update check (non-blocking)
startStartupAutoUpdateCheck(checkAndAutoUpdate);

// Check for --tui flag before parsing
if (process.argv.includes('--tui')) {
  launchTui();
} else {
  program.parse();
}
