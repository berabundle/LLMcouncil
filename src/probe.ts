import type { AgentResponse } from "./schema.js";
import { runCodex } from "./providers/codex.js";
import { runClaude } from "./providers/claude.js";
import { runGemini } from "./providers/gemini.js";

type Provider = "codex" | "claude" | "gemini";

const RUNNERS: Record<Provider, typeof runCodex> = {
  codex: runCodex,
  claude: runClaude as unknown as typeof runCodex,
  gemini: runGemini as unknown as typeof runCodex,
};

export async function probeProviders(params: {
  providers: Provider[];
  prompt: string;
  timeoutSeconds: number;
}): Promise<
  {
    provider: Provider;
    ok: boolean;
    ms: number;
    error?: string;
    response?: AgentResponse;
  }[]
> {
  const timeoutMs = params.timeoutSeconds * 1000;
  const results: {
    provider: Provider;
    ok: boolean;
    ms: number;
    error?: string;
    response?: AgentResponse;
  }[] = [];

  for (const provider of params.providers) {
    const start = Date.now();
    try {
      const { parsed } = await RUNNERS[provider]({
        agentName: `${provider}-probe`,
        round: 1,
        phase: "research",
        prompt: params.prompt,
        transcript: "[]",
        timeoutMs,
      });
      results.push({ provider, ok: true, ms: Date.now() - start, response: parsed });
    } catch (e: unknown) {
      results.push({
        provider,
        ok: false,
        ms: Date.now() - start,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return results;
}

