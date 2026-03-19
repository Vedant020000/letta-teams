import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Command } from 'commander';

import { handleCliError } from '../utils/errors.js';

type SkillScope = 'project' | 'agent' | 'global';

const SKILL_SCOPES: readonly SkillScope[] = ['project', 'agent', 'global'] as const;

function parseScope(value: string | undefined): SkillScope {
  if (!value) return 'project';
  if (SKILL_SCOPES.includes(value as SkillScope)) {
    return value as SkillScope;
  }
  throw new Error(`Invalid scope '${value}'. Must be one of: ${SKILL_SCOPES.join(', ')}`);
}

function unquote(input: string): string {
  if (
    (input.startsWith('"') && input.endsWith('"')) ||
    (input.startsWith("'") && input.endsWith("'"))
  ) {
    return input.slice(1, -1);
  }
  return input;
}

function parseLettabotWorkingDir(configContent: string): string | undefined {
  const match = configContent.match(/^\s*workingDir\s*:\s*(.+?)\s*$/m);
  if (!match?.[1]) return undefined;

  let value = match[1].trim();
  const hashIndex = value.indexOf('#');
  if (hashIndex >= 0 && !(value.startsWith('"') || value.startsWith("'"))) {
    value = value.slice(0, hashIndex).trim();
  }

  value = unquote(value).trim();
  return value.length > 0 ? value : undefined;
}

function resolveProjectRoot(): string {
  const envDir = process.env.LETTABOT_WORKING_DIR?.trim();
  if (envDir) {
    return path.resolve(process.cwd(), envDir);
  }

  const configPath = path.join(process.cwd(), 'lettabot.yaml');
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf-8');
    const configured = parseLettabotWorkingDir(content);
    if (configured) {
      return path.resolve(process.cwd(), configured);
    }
  }

  return process.cwd();
}

function resolveAgentId(): string {
  const agentId = process.env.AGENT_ID || process.env.LETTA_AGENT_ID;
  if (!agentId) {
    throw new Error('Agent scope requires AGENT_ID (or LETTA_AGENT_ID) in environment.');
  }
  return agentId;
}

function resolveScopeDir(scope: SkillScope): string {
  switch (scope) {
    case 'project':
      return path.join(resolveProjectRoot(), '.skills');
    case 'global':
      return path.join(os.homedir(), '.letta', 'skills');
    case 'agent': {
      const agentId = resolveAgentId();
      return path.join(os.homedir(), '.letta', 'agents', agentId, 'skills');
    }
  }
}

function resolveSourceSkillPath(skillName: string): string {
  const candidates = [
    path.join(process.cwd(), 'skills', `${skillName}.md`),
    path.join(process.cwd(), '.skills', skillName, 'SKILL.md'),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `Skill '${skillName}' not found. Expected one of: ${candidates.join(', ')}`,
    );
  }
  return found;
}

export function registerSkillCommands(program: Command): void {
  const skill = program
    .command('skill')
    .description('Manage skill files across project/agent/global scopes');

  skill
    .command('add <skillName>')
    .description('Install a local skill into project, agent, or global scope')
    .option('--scope <scope>', 'project|agent|global (default: project)', 'project')
    .option('--force', 'Overwrite existing skill file at destination')
    .action((skillName: string, options) => {
      const globalOpts = program.opts();

      try {
        const scope = parseScope(options.scope);
        const sourcePath = resolveSourceSkillPath(skillName);
        const scopeDir = resolveScopeDir(scope);
        const skillDir = path.join(scopeDir, skillName);
        const targetPath = path.join(skillDir, 'SKILL.md');

        if (fs.existsSync(targetPath) && !options.force) {
          throw new Error(
            `Skill already exists at ${targetPath}. Use --force to overwrite.`,
          );
        }

        fs.mkdirSync(skillDir, { recursive: true });
        const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
        fs.writeFileSync(targetPath, sourceContent);

        const result = {
          skill: skillName,
          scope,
          sourcePath,
          targetPath,
          projectRoot: scope === 'project' ? resolveProjectRoot() : undefined,
        };

        if (globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`✓ Added skill '${skillName}' (${scope})`);
          console.log(`  Source: ${sourcePath}`);
          console.log(`  Target: ${targetPath}`);
        }
      } catch (error) {
        handleCliError(error as Error, globalOpts.json);
      }
    });

  skill.action(() => {
    const globalOpts = program.opts();
    if (globalOpts.json) {
      console.log(JSON.stringify({ usage: 'letta-teams skill add <skillName> [--scope project|agent|global]' }, null, 2));
    } else {
      console.log('Usage: letta-teams skill add <skillName> [--scope project|agent|global]');
    }
  });
}
