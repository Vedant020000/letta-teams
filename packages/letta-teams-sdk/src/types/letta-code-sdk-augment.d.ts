import "@letta-ai/letta-code-sdk";

declare module "@letta-ai/letta-code-sdk" {
  interface CreateAgentOptions {
    /** Context window limit (tokens) for the agent */
    contextWindowLimit?: number;
  }
}

declare module "@letta-ai/letta-code-sdk/dist/types" {
  interface InternalSessionOptions {
    /** Context window limit (tokens) for the agent */
    contextWindowLimit?: number;
  }
}