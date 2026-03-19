import type { Command } from "commander";

import { registerAuthCommand } from "./auth.js";
import { registerCouncilCommands } from './council.js';

export function registerCommands(program: Command): void {
  registerAuthCommand(program);
  registerCouncilCommands(program);
}