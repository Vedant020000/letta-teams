import type { Command } from "commander";

import { registerAuthCommand } from "./auth.js";
import { registerCouncilCommands } from './council.js';
import { registerDaemonCommand } from "./daemon.js";
import { registerMessagingCommands } from "./messaging.js";
import { registerProgressCommands } from "./progress.js";
import { registerSkillCommands } from './skill.js';
import { registerSpawnCommands } from "./spawn.js";
import { registerTaskCommands } from "./task.js";
import { registerTeammateCommands } from "./teammate.js";

export function registerCommands(program: Command): void {
  registerAuthCommand(program);
  registerCouncilCommands(program);
  registerDaemonCommand(program);
  registerMessagingCommands(program);
  registerProgressCommands(program);
  registerSkillCommands(program);
  registerSpawnCommands(program);
  registerTaskCommands(program);
  registerTeammateCommands(program);
}
