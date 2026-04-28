import type { Command } from "commander";

import { validateName } from "letta-teams-sdk/agent";
import type { TaskState } from "letta-teams-sdk/types";
import { validateTargetName } from "letta-teams-sdk/targets";
import { getTeamsRuntime } from "letta-teams-sdk";

export function registerMessagingCommands(program: Command): void {
  const runtime = getTeamsRuntime();

  // FORK COMMAND
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

        if (!await runtime.teammates.exists(name)) {
          handleError(new Error(`Teammate '${name}' not found`), globalOpts.json);
          return;
        }

        const state = await runtime.teammates.fork(name, forkName);
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

  // MESSAGE COMMAND
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
        if (!await runtime.teammates.targetExists(name)) {
          handleError(new Error(`Target '${name}' not found`), globalOpts.json);
          return;
        }

        // Dispatch task to daemon
        const { taskId } = await runtime.tasks.dispatch({ target: name, message: prompt });

        if (options.wait) {
          // Wait for completion
          if (!globalOpts.json) {
            process.stdout.write(`[${name}] Working...\r`);
          }

          const task = await runtime.tasks.wait(taskId);

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

  // BROADCAST COMMAND
  program
    .command("broadcast [promptParts...]")
    .description("Send a message to teammates or specific targets in parallel via daemon. Use --to for specific names, or omit to message all roots.")
    .option("--to <names>", "Comma-separated list of teammate or target names to message")
    .option("--exclude <names>", "Comma-separated list of teammate or target names to exclude")
    .option("-w, --wait", "Wait for all tasks to complete and show results")
    .option("--review-by <name>", "Route worker results to reviewer target before completion")
    .option("--gate <policy>", "Review gate policy: on_success (default) or always", "on_success")
    .option("--review-template <name>", "Optional review template to load")
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
        let targets = (await runtime.teammates.list()).map((t) => t.name);
        if (targetNames && targetNames.length > 0) {
          for (const name of targetNames) {
            validateTargetName(name);
            if (!await runtime.teammates.targetExists(name)) {
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

        // Dispatch to all teammates
        const taskIds: { name: string; taskId: string }[] = [];

        for (const target of targets) {
          const { taskId } = await runtime.tasks.dispatch({ target, message: prompt });
          taskIds.push({ name: target, taskId });
        }

        if (options.wait) {
          if (!globalOpts.json) {
            console.log(`Waiting for ${taskIds.length} teammates...\n`);
          }

          const results: Record<string, { taskId: string; status: string; result?: string; error?: string }> = {};

          for (const { name, taskId } of taskIds) {
            const task = await runtime.tasks.wait(taskId);
            results[name] = {
              taskId,
              status: task.status,
              result: task.result,
              error: task.error,
            };
          }

          // Review gating is not supported for broadcast
          if (!globalOpts.json) {
            for (const [name, result] of Object.entries(results)) {
              if (result.status === "error") {
                console.log(`\n[${name}] Error: ${result.error}`);
              } else {
                console.log(`\n[${name}]\n${result.result || "(done)"}`);
              }
            }
          } else {
            console.log(JSON.stringify(results, null, 2));
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

  // DISPATCH COMMAND - Different messages to different teammates
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

        if (options.reviewBy || options.gate !== undefined || options.reviewTemplate) {
          handleError(new Error('Broadcast does not support review gating. Use dispatch instead.'), globalOpts.json);
          return;
        }

        // Dispatch to all teammates
        const taskIds: { name: string; taskId: string }[] = [];
        const assignmentList = Array.from(messages.entries()).map(([name, message]) => ({ name, message }));

        let reviewTarget: string | undefined;
        let gatePolicy: "on_success" | "always" = options.gate === "always" ? "always" : "on_success";
        const reviewTemplate: string | undefined = options.reviewTemplate;
        if (options.reviewBy) {
          validateTargetName(options.reviewBy);
          if (!await runtime.teammates.targetExists(options.reviewBy)) {
            throw new Error(`Reviewer target '${options.reviewBy}' not found`);
          }
          reviewTarget = options.reviewBy;
        }

        const pipelineId = reviewTarget
          ? `pipeline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
          : undefined;

        for (const [name, message] of messages) {
          validateTargetName(name);
          if (!await runtime.teammates.targetExists(name)) {
            throw new Error(`Target '${name}' not found`);
          }
          const { taskId } = await runtime.tasks.dispatch({
            target: name,
            message,
            options: {
            pipelineId,
            review:
              reviewTarget && pipelineId
                ? {
                    reviewer: reviewTarget,
                    gate: gatePolicy,
                    template: reviewTemplate,
                    assignments: assignmentList,
                  }
                : undefined,
            },
          });
          taskIds.push({ name, taskId });
        }

        if (options.wait) {
          // Wait for all tasks to complete
          if (!globalOpts.json) {
            console.log(`Waiting for ${taskIds.length} teammates...\n`);
          }

          const results: Record<string, { taskId: string; status: string; result?: string; error?: string }> = {};

          for (const { name, taskId } of taskIds) {
            const task = await runtime.tasks.wait(taskId);
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
}

function handleError(error: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ error: message }, null, 2));
  } else {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
  }
}

