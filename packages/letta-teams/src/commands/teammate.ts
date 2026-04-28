import type { Command } from "commander";

import { createRequire } from "node:module";
import * as readlinePromises from "node:readline/promises";

import ora from "ora";
import Letta from "@letta-ai/letta-client";

import { validateName } from "letta-teams-sdk/agent";
import {
  ensureLteamsDir,
  getConversationTarget,
  listConversationTargets,
  teammateExists,
  removeTeammate,
  listTeammates,
  loadTeammate,
  updateTeammate,
  getApiKey,
  findTasksToPrune,
  findIdleTeammates,
  findBrokenTeammates,
  deleteTasks,
  deleteTeammates,
} from "letta-teams-sdk/store";
import { parseTargetName, validateTargetName } from "letta-teams-sdk/targets";

const require = createRequire(import.meta.url);

export function registerTeammateCommands(program: Command): void {
  // PRUNE COMMAND
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
        const rl = require("readline").createInterface({
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

  // LIST COMMAND
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

  // MODEL COMMAND
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

  // INFO COMMAND
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

  // REMOVE COMMAND
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
          const rl = readlinePromises.createInterface({
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
          const LettaClient = (await import("@letta-ai/letta-client")).default;
          const client = new LettaClient({ apiKey: process.env.LETTA_API_KEY });
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

  // KILL COMMAND
  program
    .command("kill <name>")
    .description("Cancel in-flight tasks for a teammate and mark it done")
    .action(async (name: string) => {
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

      try {
        const { killTeammateViaDaemon, ensureDaemonRunning } = await import("letta-teams-sdk/ipc");
        await ensureDaemonRunning();
        const result = await killTeammateViaDaemon(name);

        if (globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`✓ Killed '${name}' (${result.cancelled} task${result.cancelled === 1 ? '' : 's'} cancelled)`);
        }
      } catch (error) {
        handleError(error as Error, globalOpts.json);
      }
    });
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

