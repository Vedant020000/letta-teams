import type { Command } from "commander";

import { registerAuthCommand } from "./auth.js";
import { registerCouncilCommands } from './council.js';
import { registerSkillCommands } from './skill.js';

export function registerCommands(program: Command): void {
  registerAuthCommand(program);
  registerCouncilCommands(program);
  registerSkillCommands(program);
}