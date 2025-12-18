import type { AgentResponse } from "./schema.js";
import { beadsAddComment, beadsListComments } from "./beads.js";
import { persistArtifacts } from "./artifacts.js";
import { formatAgentComment } from "./format.js";
import { runCodex } from "./providers/codex.js";
import { runClaude } from "./providers/claude.js";
import { runGemini } from "./providers/gemini.js";

type Provider = "codex" | "claude" | "gemini";
type EngineLogger = (line: string) => void;

const providers: Record<Provider, typeof runCodex> = {
  codex: runCodex,
  claude: runClaude as unknown as typeof runCodex,
  gemini: runGemini as unknown as typeof runCodex,
};

function pickChair(responses: { provider: Provider; response: AgentResponse }[]): Provider {
  const sorted = [...responses].sort((a, b) => b.response.chair_score - a.response.chair_score);
  return sorted[0]?.provider ?? "codex";
}

function defaultLogger(line: string): void {
  // eslint-disable-next-line no-console
  console.error(line);
}

function ms(n: number): string {
  const s = Math.floor(n / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${rem}s`;
}

async function runProviderWithHeartbeat(params: {
  provider: Provider;
  agentName: string;
  round: number;
  phase: AgentResponse["phase"];
  prompt: string;
  transcript: string;
  heartbeatSeconds: number;
  log: EngineLogger;
}): Promise<AgentResponse> {
  const { provider, heartbeatSeconds, log } = params;
  const start = Date.now();
  log(`[council] ${provider} starting (${params.phase}, round ${params.round})`);

  const interval =
    heartbeatSeconds > 0
      ? setInterval(() => {
          log(`[council] ${provider} still running… (${ms(Date.now() - start)})`);
        }, heartbeatSeconds * 1000)
      : null;

  try {
    const runner = providers[provider];
    const { parsed } = await runner({
      agentName: params.agentName,
      round: params.round,
      phase: params.phase,
      prompt: params.prompt,
      transcript: params.transcript,
    });
    log(`[council] ${provider} finished (${params.phase}, ${ms(Date.now() - start)})`);
    return parsed;
  } finally {
    if (interval) clearInterval(interval);
  }
}

export async function runCouncilSession(params: {
  issueId: string;
  prompt: string;
  maxRounds: number;
  heartbeatSeconds?: number;
  log?: EngineLogger;
}): Promise<void> {
  const { issueId, prompt, maxRounds } = params;
  const heartbeatSeconds = params.heartbeatSeconds ?? 15;
  const log = params.log ?? defaultLogger;

  for (let round = 1; round <= maxRounds; round++) {
    await beadsAddComment(issueId, `---\n**SYSTEM** Round ${round} starting (research)\n---`);
    const transcriptObj = await beadsListComments(issueId);
    const transcript = JSON.stringify(transcriptObj);

    const researchResponses: { provider: Provider; response: AgentResponse }[] = [];
    for (const provider of Object.keys(providers) as Provider[]) {
      let parsed: AgentResponse;
      try {
        await beadsAddComment(issueId, `---\n**SYSTEM** Running \`${provider}\` (research)\n---`);
        parsed = await runProviderWithHeartbeat({
          provider,
          agentName: provider,
          round,
          phase: "research",
          prompt,
          transcript,
          heartbeatSeconds,
          log,
        });
      } catch (e: unknown) {
        await beadsAddComment(issueId, `---\n**SYSTEM** Provider failure: \`${provider}\`\n\n\`\`\`\n${e instanceof Error ? e.message : String(e)}\n\`\`\`\n---`);
        throw e;
      }
      const artifactRefs = await persistArtifacts({
        issueId,
        round,
        phase: "research",
        agentName: provider,
        artifacts: parsed.artifacts,
      });
      await beadsAddComment(issueId, formatAgentComment({ provider, response: parsed, artifactRefs }));
      researchResponses.push({ provider, response: parsed });
    }

    const chair = pickChair(researchResponses);
    await beadsAddComment(issueId, `---\n**SYSTEM** Chair selected: \`${chair}\` (critique)\n---`);

    const critiqueTranscriptObj = await beadsListComments(issueId);
    const critiqueTranscript = JSON.stringify(critiqueTranscriptObj);
    const critiqueResponses: { provider: Provider; response: AgentResponse }[] = [];

    for (const provider of Object.keys(providers) as Provider[]) {
      let parsed: AgentResponse;
      try {
        await beadsAddComment(issueId, `---\n**SYSTEM** Running \`${provider}\` (critique)\n---`);
        parsed = await runProviderWithHeartbeat({
          provider,
          agentName: provider,
          round,
          phase: "critique",
          prompt,
          transcript: critiqueTranscript,
          heartbeatSeconds,
          log,
        });
      } catch (e: unknown) {
        await beadsAddComment(issueId, `---\n**SYSTEM** Provider failure: \`${provider}\`\n\n\`\`\`\n${e instanceof Error ? e.message : String(e)}\n\`\`\`\n---`);
        throw e;
      }
      const artifactRefs = await persistArtifacts({
        issueId,
        round,
        phase: "critique",
        agentName: provider,
        artifacts: parsed.artifacts,
      });
      await beadsAddComment(issueId, formatAgentComment({ provider, response: parsed, artifactRefs }));
      critiqueResponses.push({ provider, response: parsed });
    }

    const shouldContinue = critiqueResponses.some((r) => r.response.need_another_round);
    await beadsAddComment(issueId, `---\n**SYSTEM** Round ${round} synthesis (${shouldContinue ? "CONTINUE" : "DONE"})\n---`);

    const synthTranscriptObj = await beadsListComments(issueId);
    const synthTranscript = JSON.stringify(synthTranscriptObj);
    let synthesis: AgentResponse;
    try {
      await beadsAddComment(issueId, `---\n**SYSTEM** Running chair \`${chair}\` (synthesis)\n---`);
      synthesis = await runProviderWithHeartbeat({
        provider: chair,
        agentName: `${chair}-chair`,
        round,
        phase: "synthesis",
        prompt,
        transcript: synthTranscript,
        heartbeatSeconds,
        log,
      });
    } catch (e: unknown) {
      await beadsAddComment(issueId, `---\n**SYSTEM** Chair failure: \`${chair}\`\n\n\`\`\`\n${e instanceof Error ? e.message : String(e)}\n\`\`\`\n---`);
      throw e;
    }
    const synthArtifactRefs = await persistArtifacts({
      issueId,
      round,
      phase: "synthesis",
      agentName: `${chair}-chair`,
      artifacts: synthesis.artifacts,
    });
    await beadsAddComment(issueId, formatAgentComment({ provider: chair, response: synthesis, artifactRefs: synthArtifactRefs }));

    if (!shouldContinue) {
      await beadsAddComment(issueId, `---\n**SYSTEM** Session converged after round ${round}.\n---`);
      return;
    }
  }

  await beadsAddComment(issueId, `---\n**SYSTEM** Max rounds reached; stopping.\n---`);
}
