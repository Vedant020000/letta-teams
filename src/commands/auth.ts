import type { Command } from "commander";
import {
  hasAuthToken,
  loadAuthToken,
  clearAuthToken,
  promptForApiKey,
  saveAuthToken,
} from "../store.js";
import { handleCliError } from "../utils/errors.js";

export function registerAuthCommand(program: Command): void {
  program
    .command("auth [api-key]")
    .description("Configure Letta API key (stored in ~/.lteams/authtoken.json)")
    .option("--show", "Show current auth status")
    .option("--clear", "Clear stored auth token")
    .action(async (apiKey: string | undefined, options) => {
      const globalOpts = program.opts();

      if (options.show) {
        const hasToken = hasAuthToken();
        const envVar = process.env.LETTA_API_KEY ? "set" : "not set";

        if (globalOpts.json) {
          console.log(
            JSON.stringify(
              {
                hasStoredToken: hasToken,
                envVarStatus: envVar,
                source: hasToken ? "stored" : process.env.LETTA_API_KEY ? "env" : "none",
              },
              null,
              2,
            ),
          );
        } else {
          if (hasToken) {
            const token = loadAuthToken();
            console.log("✓ Auth token stored in ~/.lteams/authtoken.json");
            console.log(`  Created: ${token?.createdAt || "unknown"}`);
          } else {
            console.log("No auth token stored.");
          }
          console.log(`  Env var (LETTA_API_KEY): ${envVar}`);
        }
        return;
      }

      if (options.clear) {
        const cleared = clearAuthToken();
        if (globalOpts.json) {
          console.log(JSON.stringify({ cleared }, null, 2));
        } else {
          console.log(cleared ? "✓ Auth token cleared" : "No auth token to clear");
        }
        return;
      }

      if (!apiKey) {
        try {
          apiKey = await promptForApiKey();
        } catch (error) {
          handleCliError(error as Error, globalOpts.json);
          return; // handleCliError calls process.exit, but TypeScript needs this for control flow
        }
      }

      if (!apiKey) {
        handleCliError(new Error("API key not provided"), globalOpts.json);
        return; // handleCliError calls process.exit, but TypeScript needs this for control flow
      }

      const token = saveAuthToken(apiKey);
      if (globalOpts.json) {
        console.log(JSON.stringify({ stored: true, createdAt: token.createdAt }, null, 2));
      } else {
        console.log("✓ API key saved to ~/.lteams/authtoken.json");
      }
    });
}