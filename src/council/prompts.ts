import type { CouncilOpinionRecord } from './types.js';

export function buildCouncilKickoffPrompt(input: {
  sessionId: string;
  turn: number;
  councilPrompt: string;
  customMessage?: string;
}): string {
  return [
    `You are participating in agent council session ${input.sessionId}, turn ${input.turn}.`,
    input.customMessage ? `Coordinator message: ${input.customMessage}` : undefined,
    '',
    'Council task:',
    input.councilPrompt,
    '',
    'Instructions:',
    '- Choose a side: thesis OR antithesis.',
    '- Research and analyze deeply before deciding.',
    '- Then call tool council-write with your position and proposal.',
    '- Then call tool council-submit with action=opinion.',
    '',
    '// TODO(council): spawn disposable research/explore helper agents per member in future revision.',
  ].filter(Boolean).join('\n');
}

export function buildCouncilSynthesisPrompt(input: {
  sessionId: string;
  turn: number;
  opinions: CouncilOpinionRecord[];
}): string {
  const serialized = JSON.stringify(input.opinions, null, 2);
  return [
    `You are the synthesizer for council session ${input.sessionId}, turn ${input.turn}.`,
    'Read these member opinions and produce dense implementation key points.',
    'Do not over-compress. Include conflicts, risks, and concrete plan options.',
    '',
    serialized,
  ].join('\n');
}

export function buildCouncilVotePrompt(input: { turn: number; synthesis: string }): string {
  return [
    `Turn ${input.turn} synthesis:`,
    input.synthesis,
    '',
    'Decide now: agree or disagree.',
    'Call council-submit with action=vote, vote=<agree|disagree>, and optional note.',
  ].join('\n');
}

export function buildCouncilFinalPlan(input: {
  sessionId: string;
  prompt: string;
  synthesis: string;
  unanimous: boolean;
  turn: number;
}): string {
  return [
    `# Council Plan (${input.sessionId})`,
    '',
    `Prompt: ${input.prompt}`,
    `Final turn: ${input.turn}`,
    `Consensus: ${input.unanimous ? 'unanimous' : 'forced decision at max turn'}`,
    '',
    '## Proposed plan',
    input.synthesis,
  ].join('\n');
}
