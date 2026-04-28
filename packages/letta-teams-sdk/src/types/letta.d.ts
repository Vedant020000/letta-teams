declare module "@letta-ai/letta" {
  export interface LettaOptions {
    token?: string;
    apiKey?: string;
    baseUrl?: string;
  }

  export interface MemoryBlock {
    label: string;
    value: string;
  }

  export interface CreateAgentOptions {
    name?: string;
    description?: string;
    system?: string;
    llm?: string;
    embedding?: string;
    memory_blocks?: MemoryBlock[];
    context_window_limit?: number;
  }

  export interface Agent {
    id: string;
    name?: string;
    description?: string;
    system?: string;
    llm?: string;
    context_window_limit?: number;
  }

  export interface AgentsAPI {
    create(options: CreateAgentOptions): Promise<Agent>;
    list(): Promise<Agent[]>;
    delete(agentId: string): Promise<void>;
    get(agentId: string): Promise<Agent>;
  }

  export class Letta {
    constructor(options?: LettaOptions);
    agents: AgentsAPI;
  }
}
