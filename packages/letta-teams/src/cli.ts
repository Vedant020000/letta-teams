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
import { ensureLteamsDir } from "letta-teams-sdk/store";
import { registerCommands } from "./commands/index.js";
import { launchTui } from "./tui/index.js";
import { checkForStartupNotification, checkForUpdate, performManualUpdate } from './updater/auto-update.js';
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
program.option("--tui", "Launch interactive TUI dashboard (use --internal to include init/reinit tasks)");

registerCommands(program);

program
  .command('update')
  .description('Check for and install the latest letta-teams release')
  .option('--check', 'Only check whether an update is available')
  .action(async (options) => {
    const globalOpts = program.opts();

    try {
      if (options.check) {
        const check = await checkForUpdate();
        if (globalOpts.json) {
          console.log(JSON.stringify(check, null, 2));
          return;
        }

        if (check.updateAvailable && check.latestVersion) {
          console.log(`Update available: ${check.currentVersion} → ${check.latestVersion}`);
          console.log('Run `letta-teams update` to install.');
        } else if (check.checkFailed) {
          console.log('Update check failed. Try again later.');
        } else {
          console.log(`You are up to date (${check.currentVersion}).`);
        }
        return;
      }

      const result = await performManualUpdate();

      if (globalOpts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.updated) {
        console.log(`✓ Updated letta-teams: ${result.currentVersion} → ${result.latestVersion}`);
        return;
      }

      if (result.reason === 'up-to-date') {
        console.log(`You are up to date (${result.currentVersion}).`);
        return;
      }

      if (result.enotemptyFailed) {
        console.error('⚠️  Update failed (ENOTEMPTY).');
        console.error('Fix: rm -rf $(npm prefix -g)/lib/node_modules/letta-teams && npm i -g letta-teams');
        handleError(new Error('Auto-update failed (ENOTEMPTY)'), globalOpts.json);
        return;
      }

      handleError(new Error(result.error || 'Failed to update letta-teams'), globalOpts.json);
    } catch (error) {
      handleError(error, globalOpts.json);
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

// Start background update-availability check (non-blocking)
startStartupAutoUpdateCheck(checkForStartupNotification).then((notification) => {
  if (!notification) return;

  const globalOpts = program.opts();
  if (globalOpts.json) return;

  console.log(
    `\n↑ Update available: ${notification.currentVersion} → ${notification.latestVersion}. Run: letta-teams update\n`,
  );
});

// Check for --tui flag before parsing
if (process.argv.includes('--tui')) {
  launchTui({ includeInternal: process.argv.includes('--internal') });
} else {
  program.parse();
}

