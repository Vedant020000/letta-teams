import { checkApiKey, messageTeammate } from '../agent.js';
import { listTeammates } from '../store.js';
import { buildCouncilFinalPlan, buildCouncilKickoffPrompt, buildCouncilVotePrompt } from './prompts.js';
import { cancelRunsForCouncil } from './cancel.js';
import { createCouncilTools } from './tools.js';
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

function allParticipantsVoted(meta: CouncilSessionMeta, turn: number): boolean {
  const votesBy = meta.turns[String(turn)]?.votesBy || {};
  return meta.participants.every((name) => Boolean(votesBy[name]));
}

function isUnanimousAgree(meta: CouncilSessionMeta, turn: number): boolean {
  const votesBy = meta.turns[String(turn)]?.votesBy || {};
  return meta.participants.every((name) => votesBy[name] === 'agree');
}

function synthesizeOpinions(sessionId: string, turn: number): string {
  const opinions = listCouncilOpinions(sessionId, turn);
  if (opinions.length === 0) {
    return `No opinions were submitted for turn ${turn}.`;
  }

  const lines: string[] = [`# Turn ${turn} key points`, ''];
  for (const opinion of opinions) {
    lines.push(`## ${opinion.agentName} (${opinion.side})`);
    lines.push(`- Position: ${opinion.position}`);
    if (opinion.proposal) lines.push(`- Proposal: ${opinion.proposal}`);
    if (opinion.risks && opinion.risks.length > 0) lines.push(`- Risks: ${opinion.risks.join('; ')}`);
    if (opinion.openQuestions && opinion.openQuestions.length > 0) lines.push(`- Open questions: ${opinion.openQuestions.join('; ')}`);
    lines.push('');
  }

  lines.push('// TODO(council): replace local synthesis with disposable synthesizer agent run.');
  return lines.join('\n');
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

    if (!allParticipantsVoted(meta, turn)) {
      for (const participant of participants) {
        const vote = meta.turns[String(turn)]?.votesBy[participant.name];
        if (!vote) {
          markVote(meta, turn, participant.name, 'disagree', 'No submit received in turn window');
        }
      }
      saveCouncilSession(meta);
    }

    const synthesis = synthesizeOpinions(sessionId, turn);

    const synthesisPath = writeCouncilSynthesis(sessionId, turn, synthesis);
    lastSynthesis = synthesis;

    meta = loadCouncilSession(sessionId) ?? meta;
    const turnState = ensureCouncilTurn(meta, turn);
    turnState.synthesisPath = synthesisPath;
    turnState.completedAt = new Date().toISOString();
    saveCouncilSession(meta);

    await Promise.all(
      participants.map(async (participant) => {
        const tools = createCouncilTools({ sessionId, turn, agentName: participant.name });
        const votePrompt = buildCouncilVotePrompt({ turn, synthesis });
        try {
          await messageTeammate(participant.name, votePrompt, { tools });
        } catch {
          const current = loadCouncilSession(sessionId);
          if (!current) return;
          markVote(current, turn, participant.name, 'disagree', 'Vote prompt failed');
          saveCouncilSession(current);
        }
      }),
    );

    meta = loadCouncilSession(sessionId) ?? meta;
    if (isUnanimousAgree(meta, turn)) {
      const finalPlan = buildCouncilFinalPlan({
        sessionId,
        prompt: meta.prompt,
        synthesis,
        unanimous: true,
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
