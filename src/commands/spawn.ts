import type { Command } from "commander";
import ora from "ora";

import { checkApiKey, validateName } from "../agent.js";
import { teammateExists, removeTeammate } from "../store.js";
import { ensureDaemonRunning, spawnTeammateViaDaemon, reinitTeammateViaDaemon, waitForTask } from "../ipc.js";
import { parseMemfsStartup } from "../types.js";

export function registerSpawnCommands(program: Command): void {
  program
    .command("spawn <name> <role>")
    .description("Create a teammate with a root conversation target and optional background memory init")
    .option("--model <model>", "Model to use (e.g. claude-sonnet-4-20250514, zai/glm-5)")
    .option("--spawn-prompt <text>", "Extra specialization prompt passed to background memory initialization")
    .option("--memfs-startup <mode>", "Memfs startup mode: blocking|background|skip")
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

        const memfsStartup = parseMemfsStartup(options.memfsStartup);

        const spinner = globalOpts.json ? null : ora(`Spawning teammate '${name}'...`).start();

        // Ensure daemon is running (spawn uses createSession internally)
        await ensureDaemonRunning();

        // Spawn via daemon
        const state = await spawnTeammateViaDaemon(name, role, {
          model: options.model,
          spawnPrompt: options.spawnPrompt,
          skipInit: options.skipInit,
          memfsEnabled: !options.noMemfs,
          memfsStartup,
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
}

function handleError(error: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ error: message }, null, 2));
  } else {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
  }
}
