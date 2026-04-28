import type { Command } from "commander";

import { getTeamsRuntime } from "letta-teams-sdk";

export function registerDaemonCommand(program: Command): void {
  const runtime = getTeamsRuntime();

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

      if (options.internal) {
        const port = parseInt(options.port, 10);
        await runtime.daemon.runInternal(port);
        return;
      }

      if (options.stop) {
        const stopped = await runtime.daemon.stop();
        if (globalOpts.json) {
          console.log(JSON.stringify({ stopped }, null, 2));
        } else if (stopped) {
          console.log("Daemon stopped");
        } else {
          console.log("Daemon was not running");
        }
        return;
      }

      if (options.status) {
        const { running, port } = runtime.daemon.getStatus();
        if (globalOpts.json) {
          console.log(JSON.stringify({ running, port }, null, 2));
        } else if (running) {
          console.log(`Daemon is running on port ${port}`);
        } else {
          console.log("Daemon is not running");
        }
        return;
      }

      if (options.start || (!options.stop && !options.status)) {
        if (runtime.daemon.isRunning()) {
          const { port } = runtime.daemon.getStatus();
          if (globalOpts.json) {
            console.log(JSON.stringify({ running: true, port }, null, 2));
          } else {
            console.log(`Daemon is already running on port ${port}`);
          }
          return;
        }

        try {
          const { started, pid } = await runtime.daemon.startInBackground();
          if (globalOpts.json) {
            console.log(JSON.stringify({ started, pid }, null, 2));
          } else {
            console.log(`Daemon started in background (PID: ${pid})`);
          }
        } catch (error) {
          handleError(error, globalOpts.json);
        }
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

