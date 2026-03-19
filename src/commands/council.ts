import type { Command } from 'commander';

import { ensureDaemonRunning, startCouncilViaDaemon } from '../ipc.js';
import { handleCliError } from '../utils/errors.js';
import { listCouncilSessions, loadCouncilSession, readCouncilFinalPlan } from '../council/store.js';

function resolveSessionId(explicit?: string): string | null {
  if (explicit) return explicit;
  const sessions = listCouncilSessions();
  return sessions[0] || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerCouncilCommands(program: Command): void {
  program
    .command('agent-council')
    .description('Start a council session across teammates')
    .requiredOption('--prompt <prompt>', 'Council prompt')
    .option('--message <message>', 'Custom message describing council behavior')
    .option('--participants <names>', 'Comma-separated participant names')
    .option('--max-turns <n>', 'Maximum number of turns (default: 5)', '5')
    .action(async (options) => {
      const globalOpts = program.opts();
      try {
        await ensureDaemonRunning();
        const participants = typeof options.participants === 'string' && options.participants.trim().length > 0
          ? options.participants.split(',').map((s: string) => s.trim()).filter(Boolean)
          : undefined;
        const maxTurns = Number.parseInt(options.maxTurns, 10);

        const result = await startCouncilViaDaemon(options.prompt, {
          message: options.message,
          participantNames: participants,
          maxTurns: Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : 5,
        });

        if (globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`✓ Council started: ${result.sessionId}`);
          console.log(`  Read:  letta-teams council read ${result.sessionId}`);
          console.log(`  Watch: letta-teams council --watch ${result.sessionId}`);
        }
      } catch (error) {
        handleCliError(error as Error, globalOpts.json);
      }
    });

  const council = program
    .command('council')
    .description('Read/watch council decisions');

  council
    .command('read [sessionId]')
    .description('Read final council decision')
    .action((sessionId?: string) => {
      const globalOpts = program.opts();
      try {
        const resolved = resolveSessionId(sessionId);
        if (!resolved) {
          throw new Error('No council sessions found');
        }
        const finalPlan = readCouncilFinalPlan(resolved);
        if (!finalPlan) {
          if (globalOpts.json) {
            console.log(JSON.stringify({ sessionId: resolved, status: 'pending', message: 'please use --watch to follow' }, null, 2));
          } else {
            console.log('please use --watch to follow');
          }
          return;
        }
        if (globalOpts.json) {
          console.log(JSON.stringify({ sessionId: resolved, plan: finalPlan }, null, 2));
        } else {
          console.log(finalPlan);
        }
      } catch (error) {
        handleCliError(error as Error, globalOpts.json);
      }
    });

  council
    .option('--watch', 'Wait for final decision and print it')
    .argument('[sessionId]')
    .action(async (sessionId: string | undefined, options) => {
      const globalOpts = program.opts();
      const watch = options.watch === true;

      if (!watch) {
        if (!globalOpts.json) {
          console.log('Usage: letta-teams council --watch [sessionId]');
        }
        return;
      }

      try {
        const resolved = resolveSessionId(sessionId);
        if (!resolved) {
          throw new Error('No council sessions found');
        }

        while (true) {
          const finalPlan = readCouncilFinalPlan(resolved);
          if (finalPlan) {
            if (globalOpts.json) {
              console.log(JSON.stringify({ sessionId: resolved, plan: finalPlan }, null, 2));
            } else {
              console.log(finalPlan);
            }
            return;
          }

          const meta = loadCouncilSession(resolved);
          if (meta?.status === 'error') {
            throw new Error(meta.error || `Council ${resolved} failed`);
          }

          await sleep(1000);
        }
      } catch (error) {
        handleCliError(error as Error, globalOpts.json);
      }
    });
}
