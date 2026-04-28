export type CouncilSessionStatus = 'running' | 'decided' | 'max_turns' | 'error';

export type CouncilVote = 'agree' | 'disagree';

export type CouncilSide = 'thesis' | 'antithesis';

export interface CouncilOpinionRecord {
  sessionId: string;
  turn: number;
  agentName: string;
  side: CouncilSide;
  position: string;
  evidence?: string[];
  proposal?: string;
  risks?: string[];
  openQuestions?: string[];
  createdAt: string;
}

export interface CouncilTurnState {
  turn: number;
  startedAt: string;
  completedAt?: string;
  opinionSubmittedBy: string[];
  votesBy: Record<string, CouncilVote>;
  notesBy: Record<string, string>;
  synthesisPath?: string;
}

export interface CouncilSessionMeta {
  sessionId: string;
  prompt: string;
  message?: string;
  createdAt: string;
  updatedAt: string;
  status: CouncilSessionStatus;
  participants: string[];
  leadName?: string;
  currentTurn: number;
  maxTurns: number;
  turns: Record<string, CouncilTurnState>;
  finalPlanPath?: string;
  finalDecision?: string;
  error?: string;
}
