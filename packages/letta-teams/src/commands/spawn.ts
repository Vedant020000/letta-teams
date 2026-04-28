import type { Command } from "commander";
import ora from "ora";

import { validateName } from "letta-teams-sdk/agent";
import { parseMemfsStartup } from "letta-teams-sdk/types";
import { getTeamsRuntime } from "letta-teams-sdk";

function parseContextWindow(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Context window must be a positive integer token count");
  }
  return parsed;
}

export function registerSpawnCommands(program: Command): void {
  const runtime = getTeamsRuntime();

  program
    .command("spawn <name> <role>")
    .description("Create a teammate with a root conversation target and optional background memory init")
    .option("--model <model>", "Model to use (e.g. claude-sonnet-4-20250514, zai/glm-5)")
    .option("--context-window <tokens>", "Context window limit in tokens")
    .option("--spawn-prompt <text>", "Extra specialization prompt passed to background memory initialization")
    .option("--memfs-startup <mode>", "Memfs startup mode: blocking|background|skip")
    .option("--skip-init", "Skip background memory initialization entirely")
    .option("--no-memfs", "Disable memfs for this teammate")
    .option("--force", "Overwrite existing teammate with the same name")
    .addHelpText('after', `

Examples:
  $ letta-teams spawn backend "Backend engineer"
  $ letta-teams spawn backend "Backend engineer" --context-window 32000
  $ letta-teams spawn backend "Backend engineer" --spawn-prompt "Focus on auth systems and migrations"
  $ letta-teams spawn backend "Backend engineer" --skip-init --no-memfs
`)
    .action(async (name: string, role: string, options) => {
      const globalOpts = program.opts();
      try {
        validateName(name);

        // Handle --force by removing existing teammate first
        if (options.force && await runtime.teammates.exists(name)) {
          await runtime.teammates.remove(name);
        }

        if (await runtime.teammates.exists(name)) {
          handleError(new Error(`Teammate '${name}' already exists. Use --force to overwrite.`), globalOpts.json);
          return;
        }

        const memfsStartup = parseMemfsStartup(options.memfsStartup);

        const spinner = globalOpts.json ? null : ora(`Spawning teammate '${name}'...`).start();

        // Spawn via daemon
        const contextWindowLimit = options.contextWindow ? parseContextWindow(options.contextWindow) : undefined;

        const state = await runtime.teammates.spawn({
          name,
          role,
          model: options.model,
          contextWindowLimit,
          spawnPrompt: options.spawnPrompt,
          skipInit: options.skipInit,
          memfsEnabled: options.memfs !== false,
          memfsStartup,
        });

        if (globalOpts.json) {
          console.log(JSON.stringify(state, null, 2));
        } else {
          spinner!.succeed(`Spawned teammate '${name}'`);
          console.log(`  Agent ID: ${state.agentId}`);
          console.log(`  Role: ${state.role}`);
          if (state.model) console.log(`  Model: ${state.model}`);
          if (state.contextWindowLimit) {
            console.log(`  Context window: ${state.contextWindowLimit.toLocaleString()} tokens`);
          }
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

        if (!await runtime.teammates.exists(name)) {
          handleError(new Error(`Teammate '${name}' not found`), globalOpts.json);
          return;
        }

        const taskId = await runtime.teammates.reinit(name, {
          prompt: options.prompt,
        });

        if (options.wait) {
          if (!globalOpts.json) {
            process.stdout.write(`[${name}] Reinitializing memory...\r`);
          }

          const task = await runtime.tasks.wait(taskId);

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

