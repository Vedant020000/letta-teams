import { checkApiKey, messageTeammate } from '../agent.js';
import { listTeammates } from '../store.js';
import { buildCouncilFinalPlan, buildCouncilKickoffPrompt } from './prompts.js';
import { cancelRunsForCouncil } from './cancel.js';
import { createCouncilTools } from './tools.js';
import { runDisposableCouncilReviewer } from './reviewer.js';
import {
  ensureCouncilTurn,
  initCouncilSession,
  listCouncilOpinions,
  loadCouncilSession,
  markVote,
  saveCouncilSession,
  writeCouncilFinalPlan,
  writeCouncilSynthesis,
} from './store.js';
import type { CouncilSessionMeta } from './types.js';

export function generateCouncilSessionId(): string {
  return `council-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function processCouncilSession(input: {
  prompt: string;
  message?: string;
  sessionId: string;
  participantNames?: string[];
  maxTurns?: number;
}): Promise<{ sessionId: string }> {
  checkApiKey();

  const allTeammates = listTeammates();
  const lead = allTeammates.find((t) => t.name === 'lead');
  const participants = input.participantNames?.length
    ? allTeammates.filter((t) => input.participantNames!.includes(t.name))
    : allTeammates.filter((t) => t.name !== 'lead');

  if (participants.length === 0) {
    throw new Error('No council participants found');
  }

  const sessionId = input.sessionId;
  let meta = initCouncilSession({
    sessionId,
    prompt: input.prompt,
    message: input.message,
    participants: participants.map((t) => t.name),
    leadName: lead?.name,
    maxTurns: input.maxTurns ?? 5,
  });

  const cancelResult = await cancelRunsForCouncil(allTeammates);
  if (cancelResult.warnings.length > 0) {
    const warningNote = cancelResult.warnings.join('\n');
    meta.error = warningNote;
    saveCouncilSession(meta);
  }

  let lastSynthesis = '';

  for (let turn = 1; turn <= meta.maxTurns; turn += 1) {
    meta.currentTurn = turn;
    ensureCouncilTurn(meta, turn);
    saveCouncilSession(meta);

    const kickoffPrompt = turn === 1
      ? buildCouncilKickoffPrompt({
          sessionId,
          turn,
          councilPrompt: meta.prompt,
          customMessage: meta.message,
        })
      : buildCouncilKickoffPrompt({
          sessionId,
          turn,
          councilPrompt: `Previous synthesis:\n${lastSynthesis}\n\nOriginal prompt:\n${meta.prompt}`,
          customMessage: meta.message,
        });

    await Promise.all(
      participants.map(async (participant) => {
        const tools = createCouncilTools({ sessionId, turn, agentName: participant.name });
        try {
          await messageTeammate(participant.name, kickoffPrompt, { tools });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          const current = loadCouncilSession(sessionId);
          if (!current) return;
          markVote(current, turn, participant.name, 'disagree', `message failed: ${msg}`);
          saveCouncilSession(current);
        }
      }),
    );

    meta = loadCouncilSession(sessionId) ?? meta;
    const opinions = listCouncilOpinions(sessionId, turn);

    const reviewerResult = await runDisposableCouncilReviewer({
      sessionId,
      turn,
      councilPrompt: meta.prompt,
      opinions,
      previousSynthesis: lastSynthesis || undefined,
      customMessage: meta.message,
    });

    const synthesis = reviewerResult.summary;

    const synthesisPath = writeCouncilSynthesis(sessionId, turn, synthesis);
    lastSynthesis = synthesis;

    meta = loadCouncilSession(sessionId) ?? meta;
    const turnState = ensureCouncilTurn(meta, turn);
    turnState.synthesisPath = synthesisPath;
    turnState.completedAt = new Date().toISOString();
    saveCouncilSession(meta);

    if (reviewerResult.decision === 'finalize') {
      const finalPlan = buildCouncilFinalPlan({
        sessionId,
        prompt: meta.prompt,
        synthesis: reviewerResult.finalPlanMarkdown || synthesis,
        unanimous: false,
        turn,
      });
      const planPath = writeCouncilFinalPlan(sessionId, finalPlan);
      meta.status = 'decided';
      meta.finalPlanPath = planPath;
      meta.finalDecision = synthesis;
      saveCouncilSession(meta);
      return { sessionId };
    }
  }

  meta = loadCouncilSession(sessionId) ?? meta;
  const forcedDecision = buildCouncilFinalPlan({
    sessionId,
    prompt: meta.prompt,
    synthesis: lastSynthesis || 'No synthesis generated. Council lead must decide manually.',
    unanimous: false,
    turn: meta.maxTurns,
  });
  const planPath = writeCouncilFinalPlan(sessionId, forcedDecision);
  meta.status = 'max_turns';
  meta.finalPlanPath = planPath;
  meta.finalDecision = forcedDecision;
  saveCouncilSession(meta);

  return { sessionId };
}

export async function runCouncilSession(input: {
  prompt: string;
  message?: string;
  participantNames?: string[];
  maxTurns?: number;
  sessionId?: string;
}): Promise<{ sessionId: string }> {
  const sessionId = input.sessionId ?? generateCouncilSessionId();
  await processCouncilSession({ ...input, sessionId });
  return { sessionId };
}
