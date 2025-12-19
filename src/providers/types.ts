import type { AgentResponse } from "../schema.js";

export type ProviderName = "codex" | "claude" | "gemini" | "oracle";

export type ProviderRun = (params: {
  agentName: string;
  round: number;
  phase: AgentResponse["phase"];
  prompt: string;
  transcript: string;
  repoContext?: string;
  timeoutMs?: number;
}) => Promise<{ raw: string; parsed: AgentResponse }>;
