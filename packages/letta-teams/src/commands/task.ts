import type { Command } from "commander";
import type { TaskState } from "letta-teams-sdk/types";

import { filterVisibleTasks } from "letta-teams-sdk/task-visibility";
import { getTeamsRuntime } from "letta-teams-sdk";

export function registerTaskCommands(program: Command): void {
  const runtime = getTeamsRuntime();

  program
    .command("tasks")
    .description("Show all active tasks (running/pending), including routed fork targets")
    .option("--internal", "Include internal init/reinit tasks")
    .option("--json", "Output as JSON")
    .action(async (options) => {
      const globalOpts = program.opts();
      const jsonMode = globalOpts.json || options.json;

      const allTasks = filterVisibleTasks(await runtime.tasks.list(), options.internal || false);
      const activeTasks = allTasks.filter((t) => t.status === "pending" || t.status === "running");

      if (jsonMode) {
        console.log(JSON.stringify(activeTasks, null, 2));
        return;
      }

      if (activeTasks.length === 0) {
        console.log("No active tasks");
        return;
      }

      console.log("Active Tasks:");
      console.log("-".repeat(70));

      for (const task of activeTasks) {
        const statusIcon = task.status === "running" ? ">" : ".";
        const elapsed = task.startedAt
          ? Math.round((Date.now() - new Date(task.startedAt).getTime()) / 1000) + "s"
          : "-";
        console.log(`${statusIcon} ${task.teammateName.padEnd(12)} ${task.id.padEnd(24)} ${task.status.padEnd(8)} ${elapsed}`);
      }
    });

  program
    .command("watch [target]")
    .description("Watch task updates continuously (all tasks, a specific task ID, or teammate/target)")
    .option("--interval <ms>", "Polling interval in milliseconds (default: 1000)", "1000")
    .option("--internal", "Include internal init/reinit tasks in list mode")
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
        const task = await runtime.tasks.get(target);
        if (task) {
          watchMode = "task";
          watchedTaskId = target;
        } else if (await runtime.teammates.targetExists(target) || await runtime.teammates.exists(target)) {
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
          const task = await runtime.tasks.get(watchedTaskId);
          if (!task) {
            handleError(new Error(`Task '${watchedTaskId}' not found`), jsonMode);
            return;
          }

          if (jsonMode) {
            console.log(JSON.stringify({ watchedTaskId, timestamp: nowIso, task }, null, 2));
          } else {
            clearScreenIfTty();
            console.log(`Watching task ${task.id} (Ctrl+C to stop)`);
            console.log("-".repeat(70));
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
          const allTasks = filterVisibleTasks(await runtime.tasks.list(), options.internal || false);
          const filteredTasks = watchedTargetName
            ? allTasks.filter((task) => matchesWatchTarget(task, watchedTargetName))
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
              console.log("-".repeat(90));
              for (const task of activeTasks) {
                const statusIcon = task.status === "running" ? ">" : ".";
                const targetLabel = task.targetName || task.teammateName;
                console.log(
                  `${statusIcon} ${targetLabel.padEnd(20)} ${task.id.padEnd(24)} ${task.status.padEnd(8)} ${formatElapsed(task)}`,
                );
              }
            }

            if (recentCompleted.length > 0) {
              console.log();
              console.log("Recent Completed (last 10):");
              console.log("-".repeat(90));
              for (const task of recentCompleted) {
                const icon = task.status === "done" ? "+" : "!";
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

      if (options.cancel) {
        const task = await runtime.tasks.get(id);
        if (!task) {
          handleError(new Error(`Task '${id}' not found`), jsonMode);
          return;
        }
        if (task.status !== "pending" && task.status !== "running") {
          console.log(`Task ${id} is already ${task.status}`);
          return;
        }
        await runtime.tasks.cancel(id);
        console.log(`Cancelled task ${id}`);
        return;
      }

      if (options.wait) {
        let task = await runtime.tasks.get(id);
        if (!task) {
          handleError(new Error(`Task '${id}' not found`), jsonMode);
          return;
        }

        process.stdout.write(`Waiting for task ${id}...`);
        while (task && (task.status === "pending" || task.status === "running")) {
          process.stdout.write(".");
          await new Promise((resolve) => setTimeout(resolve, 1000));
          task = await runtime.tasks.get(id);
        }
        console.log();

        if (!task) {
          handleError(new Error(`Task '${id}' disappeared`), jsonMode);
          return;
        }
      }

      const task = await runtime.tasks.get(id);
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
      console.log("Message:");
      console.log(`  ${task.message}`);

      if (task.toolCalls && task.toolCalls.length > 0 && (options.verbose || !task.result)) {
        console.log();
        console.log("Tool Calls:");
        for (const tc of task.toolCalls) {
          const icon = tc.success ? "+" : "!";
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

        console.log("Result:");
        for (const line of lines.slice(0, maxLines)) {
          console.log(`  ${line}`);
        }
        if (truncated) {
          console.log(`  ... (${lines.length - maxLines} more lines, run with --full to see all)`);
        }
      } else if (task.status === "done") {
        console.log("Result:");
        console.log("  (no output)");
      }
      if (task.error) {
        console.log();
        console.log("Error:");
        for (const line of task.error.split("\n")) {
          console.log(`  ${line}`);
        }
      }
    });
}

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

function handleError(error: unknown, jsonMode: boolean): void {
  const message = error instanceof Error ? error.message : String(error);

  if (jsonMode) {
    console.error(JSON.stringify({ error: message }));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(1);
}

