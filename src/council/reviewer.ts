import Letta from '@letta-ai/letta-client';
import { createAgent, createSession } from '@letta-ai/letta-code-sdk';

import { checkApiKey } from '../agent.js';
import { buildCouncilReviewerPrompt } from './prompts.js';
import type { CouncilOpinionRecord } from './types.js';

export interface CouncilReviewerResult {
  decision: 'continue' | 'finalize';
  summary: string;
  finalPlanMarkdown?: string;
  confidence?: number;
  nextFocus?: string[];
}

function buildCouncilReviewerMemoryBlocks(): Array<{ label: string; value: string; description: string }> {
  return [
    {
      label: 'identity',
      description: 'Disposable council reviewer identity.',
      value: `You are a disposable council reviewer agent for letta-teams.
You are neutral and do not pick sides before analysis.
You are responsible for review quality and final reporting clarity.`,
    },
    {
      label: 'review-contract',
      description: 'How to review council opinions.',
      value: `Review all participant opinions deeply.
Compare tradeoffs, risks, evidence quality, and implementation realism.
Reject vague plans. Favor concrete plans with clear validation steps.
Only you decide whether the council should finalize now or continue.`,
    },
    {
      label: 'output-contract',
      description: 'Strict response format.',
      value: `Return ONLY a single JSON object with fields:
- decision: "continue" | "finalize"
- summary: string (dense synthesis)
- final_plan_markdown: string (required when decision=finalize)
- confidence: number 0..100
- next_focus: string[]

No extra prose before or after JSON.`,
    },
  ];
}

function parseReviewerJson(raw: string): CouncilReviewerResult {
  const trimmed = raw.trim();

  const jsonBlockMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  const candidate = jsonBlockMatch?.[1]?.trim() || trimmed;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    throw new Error('Reviewer agent returned invalid JSON');
  }

  const decision = parsed.decision;
  if (decision !== 'continue' && decision !== 'finalize') {
    throw new Error('Reviewer decision must be continue or finalize');
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  if (!summary) {
    throw new Error('Reviewer summary is required');
  }

  const finalPlanMarkdown =
    typeof parsed.final_plan_markdown === 'string' && parsed.final_plan_markdown.trim().length > 0
      ? parsed.final_plan_markdown
      : undefined;

  if (decision === 'finalize' && !finalPlanMarkdown) {
    throw new Error('Reviewer must provide final_plan_markdown when decision=finalize');
  }

  const confidence = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(100, parsed.confidence))
    : undefined;

  const nextFocus = Array.isArray(parsed.next_focus)
    ? parsed.next_focus.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : undefined;

  return {
    decision,
    summary,
    finalPlanMarkdown,
    confidence,
    nextFocus,
  };
}

async function deleteAgentFromServer(agentId: string): Promise<void> {
  try {
    const client = new Letta({ apiKey: process.env.LETTA_API_KEY });
    await client.agents.delete(agentId);
  } catch {
    // best effort cleanup for disposable reviewer
  }
}

export async function runDisposableCouncilReviewer(input: {
  sessionId: string;
  turn: number;
  councilPrompt: string;
  opinions: CouncilOpinionRecord[];
  previousSynthesis?: string;
  customMessage?: string;
}): Promise<CouncilReviewerResult> {
  checkApiKey();

  let reviewerAgentId: string | undefined;
  try {
    reviewerAgentId = await createAgent({
      model: 'letta/auto',
      tags: ['origin:letta-teams', 'kind:council-reviewer', `session:${input.sessionId}`],
      memory: buildCouncilReviewerMemoryBlocks(),
      memfs: false,
    });

    await using session = createSession(reviewerAgentId, {
      permissionMode: 'bypassPermissions',
      disallowedTools: ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'],
      memfs: false,
    });

    await session.send(
      buildCouncilReviewerPrompt({
        sessionId: input.sessionId,
        turn: input.turn,
        prompt: input.councilPrompt,
        opinions: input.opinions,
        previousSynthesis: input.previousSynthesis,
        customMessage: input.customMessage,
      }),
    );

    let accumulated = '';
    for await (const msg of session.stream()) {
      if (msg.type === 'assistant' && typeof msg.content === 'string') {
        accumulated += msg.content;
      }

      if (msg.type === 'error') {
        throw new Error(msg.message);
      }

      if (msg.type === 'result') {
        const raw = msg.result || accumulated;
        return parseReviewerJson(raw);
      }
    }

    return parseReviewerJson(accumulated);
  } finally {
    if (reviewerAgentId) {
      await deleteAgentFromServer(reviewerAgentId);
    }
  }
}
