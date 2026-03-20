import type { Command } from "commander";

import { checkApiKey } from "../agent.js";
import { startDaemon, stopDaemon, getDaemonPort } from "../daemon.js";
import {
  startDaemonInBackground,
  waitForDaemon,
  getDaemonLogPath,
  isDaemonRunning,
} from "../ipc.js";

export function registerDaemonCommand(program: Command): void {
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
}

function handleError(error: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ error: message }, null, 2));
  } else {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
  }
}
