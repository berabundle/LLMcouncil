import type { AgentResponse } from "./schema.js";
import { beadsAddComment, beadsListComments } from "./beads.js";
import { persistArtifacts } from "./artifacts.js";
import { formatAgentComment } from "./format.js";
import { runCodex } from "./providers/codex.js";
import { runClaude } from "./providers/claude.js";
import { runGemini } from "./providers/gemini.js";

type Provider = "codex" | "claude" | "gemini";

const providers: Record<Provider, typeof runCodex> = {
  codex: runCodex,
  claude: runClaude as unknown as typeof runCodex,
  gemini: runGemini as unknown as typeof runCodex,
};

function pickChair(responses: { provider: Provider; response: AgentResponse }[]): Provider {
  const sorted = [...responses].sort((a, b) => b.response.chair_score - a.response.chair_score);
  return sorted[0]?.provider ?? "codex";
}

export async function runCouncilSession(params: {
  issueId: string;
  prompt: string;
  maxRounds: number;
}): Promise<void> {
  const { issueId, prompt, maxRounds } = params;

  for (let round = 1; round <= maxRounds; round++) {
    await beadsAddComment(issueId, `---\n**SYSTEM** Round ${round} starting (research)\n---`);
    const transcriptObj = await beadsListComments(issueId);
    const transcript = JSON.stringify(transcriptObj);

    const researchResponses: { provider: Provider; response: AgentResponse }[] = [];
    for (const provider of Object.keys(providers) as Provider[]) {
      const runner = providers[provider];
      let parsed: AgentResponse;
      try {
        ({ parsed } = await runner({
          agentName: provider,
          round,
          phase: "research",
          prompt,
          transcript,
        }));
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
      const runner = providers[provider];
      let parsed: AgentResponse;
      try {
        ({ parsed } = await runner({
          agentName: provider,
          round,
          phase: "critique",
          prompt,
          transcript: critiqueTranscript,
        }));
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
      ({ parsed: synthesis } = await providers[chair]({
        agentName: `${chair}-chair`,
        round,
        phase: "synthesis",
        prompt,
        transcript: synthTranscript,
      }));
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
