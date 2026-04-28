import type { TeammateState } from "./types.js";

function quoteBlock(value: string): string {
  return value
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function optionalPromptSection(title: string, value?: string): string {
  if (!value) return "";
  return `\n## ${title}\n${quoteBlock(value)}\n`;
}

/**
 * Build the background initialization prompt for a teammate.
 * This uses the teammate's role and optional spawn prompt to ask the agent
 * to initialize durable memory for future work.
 */
export function buildInitPrompt(state: TeammateState): string {
  const spawnPromptSection = optionalPromptSection("Spawn Prompt", state.spawnPrompt);

  return `# Background Memory Initialization

You are running a one-time memory initialization pass as a spawned teammate inside letta-teams.

## Identity
- Name: ${state.name}
- Role: ${state.role}

${spawnPromptSection}
## Goal
Initialize durable memory for your role so future work is faster, narrower, and more consistent.

Your memory should capture enduring behavior, role boundaries, and useful project-relevant specialization. Do not turn this into a scratchpad for the current session.

## Memory principles

Follow these rules closely:

1. Store durable information, not transient details.
2. Prefer concise, high-signal summaries over verbose notes.
3. Capture procedures, preferences, heuristics, and scope boundaries that will matter in later sessions.
4. Do not store temporary blockers, current tasks, or ephemeral progress.
5. If memfs is enabled, organize memory there thoughtfully rather than creating redundant noise.
6. Keep memory specialized to your role instead of trying to become a generalist.

## What to remember

Prioritize durable information such as:

- your role definition and specialization boundaries
- what kinds of tasks you should own vs avoid
- typical deliverables for this role
- heuristics and checklists that improve repeated work
- role-specific quality bars
- stable project-relevant context implied by the role or spawn prompt

Examples:

- a frontend-focused teammate should remember UI architecture concerns, accessibility expectations, component quality bars, and browser-facing debugging heuristics
- a testing-focused teammate should remember test strategy, failure analysis approach, and validation priorities
- a backend-focused teammate should remember API contracts, reliability concerns, and data-flow correctness priorities

## What not to remember

Do NOT store:

- current assignment details
- temporary plans
- one-off debugging notes
- current blockers
- dashboard progress updates
- anything that would go stale quickly

## Memfs

- Memfs enabled: ${state.memfsEnabled ? "yes" : "no"}
- If memfs is enabled, use it to organize durable memory cleanly.
- If memfs is not enabled, still initialize durable memory through the normal memory mechanisms available to you.

## Execution guidance

Work autonomously.

- Do not ask the user questions.
- Do not optimize for pleasing prose.
- Optimize for durable operational memory.
- If the spawn prompt is broad, distill it into a narrow, practical specialization.
- If the role and spawn prompt conflict, prefer the spawn prompt as the stronger specialization hint.

## Completion contract

At the end, reply with exactly these fields:

INIT_STATUS: done
SPEC_ID: <short stable spec id or custom>
SPECIALIZATION: <short title>
SUMMARY: <1-3 sentence summary of the durable memory you initialized>`;
}

export function buildReinitPrompt(state: TeammateState, prompt?: string): string {
  const spawnPromptSection = optionalPromptSection("Original Spawn Prompt", state.spawnPrompt);
  const extraPromptSection = optionalPromptSection("Reinit Instructions", prompt);

  return `# Background Memory Reinitialization

You are running a non-destructive memory reinitialization pass as an existing spawned teammate inside letta-teams.

## Identity
- Name: ${state.name}
- Role: ${state.role}

${spawnPromptSection}${extraPromptSection}
## Goal
Refresh and improve your durable memory so future work is faster, narrower, and more consistent.

This is an update pass, not a reset. Preserve useful durable knowledge, refine organization, and remove only clearly stale, redundant, or low-signal content.

## Rules

1. Do not wipe or replace memory wholesale.
2. Update existing durable memory in place when possible.
3. Keep useful identity, role boundaries, project context, and heuristics.
4. Remove only obvious noise, duplication, or stale content.
5. Do not store current tasks, transient progress, or short-lived notes.
6. If memfs is enabled, organize and refine memory there cleanly.

## Memfs

- Memfs enabled: ${state.memfsEnabled ? "yes" : "no"}
- If memfs is enabled, improve existing memory structure without destructive resets.

## Completion contract

At the end, reply with exactly these fields:

INIT_STATUS: done
SPEC_ID: <short stable spec id or custom>
SPECIALIZATION: <short title>
SUMMARY: <1-3 sentence summary of the durable memory you updated>`;
}

export interface ParsedInitResult {
  initStatus: "done" | "error";
  selectedSpecId?: string;
  selectedSpecTitle?: string;
  summary?: string;
}

export function parseInitResult(result: string): ParsedInitResult {
  const statusMatch = result.match(/^INIT_STATUS:\s*(.+)$/mi);
  const specIdMatch = result.match(/^SPEC_ID:\s*(.+)$/mi);
  const specializationMatch = result.match(/^SPECIALIZATION:\s*(.+)$/mi);
  const summaryMatch = result.match(/^SUMMARY:\s*(.+)$/mi);

  const status = statusMatch?.[1]?.trim().toLowerCase();
  return {
    initStatus: status === "done" ? "done" : "error",
    selectedSpecId: specIdMatch?.[1]?.trim(),
    selectedSpecTitle: specializationMatch?.[1]?.trim(),
    summary: summaryMatch?.[1]?.trim(),
  };
}