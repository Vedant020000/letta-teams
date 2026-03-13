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
  teammateExists,
  removeTeammate,
  listTeammates,
  loadTeammate,
  updateTeammate,
  getApiKey,
  updateTodo,
  updateWork,
  reportProblem,
  clearProblem,
  updateProgress,
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
  waitForTask,
  spawnTeammateViaDaemon,
  isDaemonRunning,
} from "./ipc.js";
import { displayDashboard } from "./dashboard.js";
import { registerCommands } from "./commands/index.js";
import { launchTui } from "./tui/index.js";
import { checkAndAutoUpdate } from "./updater/auto-update.js";
import { startStartupAutoUpdateCheck } from "./updater/startup-auto-update.js";

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
  .description("Create a new teammate agent with default Letta Code configuration")
  .option("--model <model>", "Model to use (e.g., claude-sonnet-4-20250514, zai/glm-5)")
  .option("--spawn-prompt <text>", "Extra specialization prompt used for background memory initialization")
  .option("--skip-init", "Skip background memory initialization")
  .option("--no-memfs", "Disable memfs for this teammate")
  .option("--force", "Overwrite existing teammate with same name")
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
// MESSAGE COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("message")
  .alias("msg")
  .description("Send a message to a teammate. Uses daemon for background processing.")
  .argument("<name>", "Name of the teammate")
  .argument("[prompt...]", "Message to send (all remaining arguments joined together)")
  .option("-w, --wait", "Wait for task to complete and show result")
  .option("-v, --verbose", "Show tool calls and intermediate steps (requires --wait)")
  .action(async (name: string, promptParts: string[], options) => {
    const globalOpts = program.opts();
    const prompt = promptParts.join(" ");

    if (!prompt) {
      handleError(new Error("Please provide a message to send"), globalOpts.json);
      return;
    }

    try {
      validateName(name);

      // Check if teammate exists (fail fast)
      if (!teammateExists(name)) {
        handleError(new Error(`Teammate '${name}' not found`), globalOpts.json);
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
  .description("Send a message to teammates in parallel via daemon. Use --to for specific names, or omit to message all.")
  .option("--to <names>", "Comma-separated list of teammate names to message")
  .option("--exclude <names>", "Comma-separated list of teammate names to exclude")
  .option("-w, --wait", "Wait for all tasks to complete and show results")
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
      let teammates = listTeammates();
      if (targetNames && targetNames.length > 0) {
        for (const name of targetNames) {
          if (!teammates.some((t) => t.name === name)) {
            handleError(new Error(`Teammate '${name}' not found`), globalOpts.json);
            return;
          }
        }
        teammates = teammates.filter((t) => targetNames.includes(t.name));
      }
      teammates = teammates.filter((t) => !exclude.includes(t.name));

      if (teammates.length === 0) {
        handleError(new Error("No teammates to broadcast to"), globalOpts.json);
        return;
      }

      // Ensure daemon is running
      await ensureDaemonRunning();

      // Dispatch to all teammates
      const taskIds: { name: string; taskId: string }[] = [];

      for (const teammate of teammates) {
        const { taskId } = await dispatchTask(teammate.name, prompt);
        taskIds.push({ name: teammate.name, taskId });
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
  .description("Send different messages to different teammates via daemon. Format: name=message or name:\"message with spaces\"")
  .option("-w, --wait", "Wait for all tasks to complete and show results")
  .action(async (assignments: string[], options) => {
    const globalOpts = program.opts();
    try {
      // Parse assignments: name=message or name:"message" pairs
      const messages = new Map<string, string>();

      for (const arg of assignments) {
        // Try name:"message" format first
        const quotedMatch = arg.match(/^(\w+):"(.+)"$/);
        if (quotedMatch) {
          const [, name, message] = quotedMatch;
          messages.set(name, message);
          continue;
        }

        // Try name=message format
        const eqMatch = arg.match(/^(\w+)=(.+)$/);
        if (eqMatch) {
          const [, name, message] = eqMatch;
          messages.set(name, message);
          continue;
        }

        // Try name:message format (colon without quotes)
        const colonMatch = arg.match(/^(\w+):(.+)$/);
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
  .description("List all teammates")
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
        console.log(`  ${t.name}`);
        if (t.model) console.log(`    Model: ${t.model}`);
        console.log(`    Status: ${t.status}`);
        if (t.todo) console.log(`    Todo: ${t.todo}`);
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
  .description("Show detailed info about a teammate")
  .action((name: string) => {
    const globalOpts = program.opts();
    try {
      validateName(name);
    } catch (error) {
      handleError(error as Error, globalOpts.json);
      return;
    }
    const state = loadTeammate(name);

    if (!state) {
      handleError(new Error(`Teammate '${name}' not found`), globalOpts.json);
      return;
    }

    if (globalOpts.json) {
      console.log(JSON.stringify(state, null, 2));
    } else {
      console.log(`Teammate: ${state.name}`);
      console.log(`  Agent ID: ${state.agentId}`);
      if (state.conversationId) {
        console.log(`  Conversation ID: ${state.conversationId}`);
      }
      if (state.model) console.log(`  Model: ${state.model}`);
      console.log(`  Memfs: ${state.memfsEnabled ? `enabled (${state.memfsStartup})` : 'disabled'}`);
      console.log(`  Status: ${state.status}`);
      if (state.todo) console.log(`  Todo: ${state.todo}`);
      console.log(`  Created: ${state.createdAt}`);
      console.log(`  Last updated: ${state.lastUpdated}`);
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
// STATUS COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("status")
  .description("Show status summary of all teammates")
  .action(() => {
    const globalOpts = program.opts();
    const teammates = listTeammates();

    if (globalOpts.json) {
      console.log(JSON.stringify(teammates, null, 2));
    } else {
      if (teammates.length === 0) {
        console.log("No teammates found.");
        return;
      }

      console.log("Team Status:\n");
      console.log("  Name          Status    Todo");
      console.log("  ────────────  ────────  ────────────────────────────");

      for (const t of teammates) {
        const name = t.name.padEnd(12).slice(0, 12);
        const status = t.status.padEnd(8);
        const todo = (t.todo || "-").slice(0, 28);
        console.log(`  ${name}  ${status}  ${todo}`);
      }
    }
  });

// ═══════════════════════════════════════════════════════════════
// DASHBOARD COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("dashboard")
  .description("Show what's happening now - active work, recent activity, and idle teammates")
  .option("--limit <number>", "Number of recent items to show (default: 10)", "10")
  .option("--verbose", "Show full task results instead of truncated")
  .option("--json", "Output as JSON")
  .action((options) => {
    const globalOpts = program.opts();
    const jsonMode = globalOpts.json || options.json;
    const limit = parseInt(options.limit, 10);
    const verbose = options.verbose || false;

    displayDashboard({ limit, verbose, json: jsonMode });
  });

// ═══════════════════════════════════════════════════════════════
// TASKS COMMAND - Show all active tasks
// ═══════════════════════════════════════════════════════════════

program
  .command("tasks")
  .description("Show all active tasks (running/pending)")
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
// TASK COMMAND - View specific task details
// ═══════════════════════════════════════════════════════════════

program
  .command("task <id>")
  .description("Show details of a specific task")
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
// TODO COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("todo <name> <text>")
  .description("Update a teammate's todo field (used by teammates to report progress)")
  .action((name: string, text: string) => {
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

    const state = updateTodo(name, text);

    if (globalOpts.json) {
      console.log(JSON.stringify(state, null, 2));
    } else {
      console.log(`✓ Updated todo for '${name}': ${text}`);
    }
  });

// ═══════════════════════════════════════════════════════════════
// WORK COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("work <name> <task>")
  .description("Update what a teammate is currently working on")
  .option("--progress <number>", "Progress percentage (0-100)")
  .option("--note <text>", "Progress note (e.g., '3 of 5 files')")
  .action((name: string, task: string, options) => {
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

    const progress = options.progress ? parseInt(options.progress, 10) : undefined;
    const state = updateWork(name, {
      currentTask: task,
      progress,
      progressNote: options.note,
    });

    if (globalOpts.json) {
      console.log(JSON.stringify(state, null, 2));
    } else {
      console.log(`✓ Updated work for '${name}': ${task}`);
      if (progress !== undefined) {
        console.log(`  Progress: ${progress}%`);
      }
    }
  });

// ═══════════════════════════════════════════════════════════════
// PROBLEM COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("problem <name> <problem>")
  .description("Report a problem/blocker a teammate is facing")
  .action((name: string, problem: string) => {
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

    const state = reportProblem(name, problem);

    if (globalOpts.json) {
      console.log(JSON.stringify(state, null, 2));
    } else {
      console.log(`✓ Reported problem for '${name}': ${problem}`);
    }
  });

// ═══════════════════════════════════════════════════════════════
// CLEAR-PROBLEM COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("clear-problem <name>")
  .description("Clear a teammate's problem and set status back to working")
  .action((name: string) => {
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

    const state = clearProblem(name);

    if (globalOpts.json) {
      console.log(JSON.stringify(state, null, 2));
    } else {
      console.log(`✓ Cleared problem for '${name}'`);
    }
  });

// ═══════════════════════════════════════════════════════════════
// UPDATE-PROGRESS COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command("update-progress <name>")
  .description("Update a teammate's progress (used by agents to self-report)")
  .option("--task <text>", "Current task description")
  .option("--progress <number>", "Progress percentage (0-100)")
  .option("--note <text>", "Progress note (e.g., '3 of 5 files')")
  .option("--problem <text>", "Report a blocker/issue")
  .option("--done", "Mark task as complete")
  .option("--add-pending <task>", "Add task to pending queue")
  .option("--complete-task <task>", "Move task from pending to completed")
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

    // Parse progress as number
    const progress = options.progress ? parseInt(options.progress, 10) : undefined;

    const state = updateProgress(name, {
      task: options.task,
      progress,
      note: options.note,
      problem: options.problem,
      addPending: options.addPending,
      completeTask: options.completeTask,
      done: options.done,
    });

    if (globalOpts.json) {
      console.log(JSON.stringify(state, null, 2));
    } else {
      // Build feedback message based on what was updated
      const updates: string[] = [];
      if (options.task) updates.push(`task: "${options.task}"`);
      if (progress !== undefined) updates.push(`progress: ${progress}%`);
      if (options.note) updates.push(`note: "${options.note}"`);
      if (options.problem) updates.push(`problem: "${options.problem}"`);
      if (options.addPending) updates.push(`added pending: "${options.addPending}"`);
      if (options.completeTask) updates.push(`completed: "${options.completeTask}"`);
      if (options.done) updates.push("marked as done");

      if (updates.length === 0) {
        console.log(`✓ Updated '${name}' (no changes specified)`);
      } else {
        console.log(`✓ Updated '${name}': ${updates.join(", ")}`);
      }
    }
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
