import type { AgentResponse } from "./schema.js";
import { beadsAddComment, beadsListComments } from "./beads.js";
import { persistArtifacts } from "./artifacts.js";
import { findUserReplySince, maxBeadsCommentId, parseBeadsComments } from "./beads_comments.js";
import { formatAgentComment } from "./format.js";
import { runCodex } from "./providers/codex.js";
import { runClaude } from "./providers/claude.js";
import { runGemini } from "./providers/gemini.js";
import { buildRepoContext } from "./repo_context.js";

type Provider = "codex" | "claude" | "gemini";
type EngineLogger = (line: string) => void;

export type EngineEvent =
  | {
      type: "phase_started" | "phase_finished";
      issueId: string;
      round: number;
      phase: AgentResponse["phase"];
    }
  | {
      type: "provider_started" | "provider_finished";
      issueId: string;
      provider: Provider;
      agentName: string;
      round: number;
      phase: AgentResponse["phase"];
      elapsedMs?: number;
      ok?: boolean;
      error?: string;
    }
  | {
      type: "waiting_for_user" | "user_input_received" | "user_input_timed_out";
      issueId: string;
      round: number;
      phase: AgentResponse["phase"];
      timeoutSeconds?: number;
      waitsUsed?: number;
      waitsMax?: number;
      questions?: string[];
      message?: string;
    }
  | {
      type: "beads_comment_posted";
      issueId: string;
      round: number | null;
      phase: AgentResponse["phase"] | null;
      bytes: number;
    };

const providers: Record<Provider, typeof runCodex> = {
  codex: runCodex,
  claude: runClaude as unknown as typeof runCodex,
  gemini: runGemini as unknown as typeof runCodex,
};

function pickChair(responses: { provider: Provider; response: AgentResponse }[]): Provider {
  const sorted = [...responses].sort((a, b) => b.response.chair_score - a.response.chair_score);
  return sorted[0]?.provider ?? "codex";
}

function formatError(e: unknown): string {
  if (e && typeof e === "object") {
    const anyErr = e as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof anyErr.shortMessage === "string") parts.push(anyErr.shortMessage);
    if (typeof anyErr.message === "string") parts.push(anyErr.message);
    if (typeof anyErr.stderr === "string" && anyErr.stderr.trim()) parts.push(`stderr:\n${anyErr.stderr}`);
    if (typeof anyErr.stdout === "string" && anyErr.stdout.trim()) parts.push(`stdout:\n${anyErr.stdout}`);
    const combined = parts.filter(Boolean).join("\n\n").trim();
    if (combined) return combined;
  }
  if (e instanceof Error) return e.message;
  return String(e);
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
  issueId: string;
  provider: Provider;
  agentName: string;
  round: number;
  phase: AgentResponse["phase"];
  prompt: string;
  transcript: string;
  repoContext?: string;
  heartbeatSeconds: number;
  beadsHeartbeatSeconds: number;
  beadsHeartbeatMax: number;
  onBeadsHeartbeat?: (elapsedMs: number) => Promise<void>;
  timeoutMs?: number;
  log: EngineLogger;
  onEvent?: (event: EngineEvent) => void;
}): Promise<AgentResponse> {
  const { provider, heartbeatSeconds, beadsHeartbeatSeconds, beadsHeartbeatMax, log } = params;
  const start = Date.now();
  params.onEvent?.({
    type: "provider_started",
    issueId: params.issueId,
    provider,
    agentName: params.agentName,
    round: params.round,
    phase: params.phase,
  });
  log(`[council] ${provider} starting (${params.phase}, round ${params.round})`);

  const consoleInterval =
    heartbeatSeconds > 0
      ? setInterval(() => {
          log(`[council] ${provider} still running… (${ms(Date.now() - start)})`);
        }, heartbeatSeconds * 1000)
      : null;

  let beadsSent = 0;
  let beadsInFlight = false;
  const beadsInterval =
    beadsHeartbeatSeconds > 0 && params.onBeadsHeartbeat
      ? setInterval(() => {
          if (beadsInFlight) return;
          if (beadsSent >= beadsHeartbeatMax) return;
          beadsInFlight = true;
          const elapsedMs = Date.now() - start;
          void params
            .onBeadsHeartbeat?.(elapsedMs)
            .catch(() => undefined)
            .finally(() => {
              beadsSent += 1;
              beadsInFlight = false;
            });
        }, beadsHeartbeatSeconds * 1000)
      : null;

  try {
    const runner = providers[provider];
    const { parsed } = await runner({
      agentName: params.agentName,
      round: params.round,
      phase: params.phase,
      prompt: params.prompt,
      transcript: params.transcript,
      repoContext: params.repoContext,
      timeoutMs: params.timeoutMs,
    });
    params.onEvent?.({
      type: "provider_finished",
      issueId: params.issueId,
      provider,
      agentName: params.agentName,
      round: params.round,
      phase: params.phase,
      elapsedMs: Date.now() - start,
      ok: true,
    });
    log(`[council] ${provider} finished (${params.phase}, ${ms(Date.now() - start)})`);
    return parsed;
  } catch (e: unknown) {
    params.onEvent?.({
      type: "provider_finished",
      issueId: params.issueId,
      provider,
      agentName: params.agentName,
      round: params.round,
      phase: params.phase,
      elapsedMs: Date.now() - start,
      ok: false,
      error: formatError(e),
    });
    throw e;
  } finally {
    if (consoleInterval) clearInterval(consoleInterval);
    if (beadsInterval) clearInterval(beadsInterval);
  }
}

export async function runCouncilSession(params: {
  issueId: string;
  prompt: string;
  maxRounds: number;
  heartbeatSeconds?: number;
  beadsHeartbeatSeconds?: number;
  beadsHeartbeatMax?: number;
  timeoutSeconds?: number;
  userWaitSeconds?: number;
  maxUserWaits?: number;
  userPollSeconds?: number;
  repoContextEnabled?: boolean;
  repoContextBudgetBytes?: number;
  repoContextMaxMatches?: number;
  repoContextExcerptRadiusLines?: number;
  log?: EngineLogger;
  onEvent?: (event: EngineEvent) => void;
}): Promise<void> {
  const { issueId, prompt, maxRounds } = params;
  const heartbeatSeconds = params.heartbeatSeconds ?? 15;
  const beadsHeartbeatSeconds = params.beadsHeartbeatSeconds ?? 60;
  const beadsHeartbeatMax = params.beadsHeartbeatMax ?? 5;
  const timeoutMs = (params.timeoutSeconds ?? 600) * 1000;
  const userWaitSeconds = params.userWaitSeconds ?? 60;
  const maxUserWaits = params.maxUserWaits ?? 2;
  const userPollSeconds = params.userPollSeconds ?? 2;
  const repoContextEnabled = params.repoContextEnabled ?? true;
  const repoContextBudgetBytes = params.repoContextBudgetBytes ?? 12_000;
  const repoContextMaxMatches = params.repoContextMaxMatches ?? 40;
  const repoContextExcerptRadiusLines = params.repoContextExcerptRadiusLines ?? 2;
  const log = params.log ?? defaultLogger;
  const emit = params.onEvent;

  async function postComment(params2: {
    round: number | null;
    phase: AgentResponse["phase"] | null;
    text: string;
  }): Promise<void> {
    await beadsAddComment(issueId, params2.text);
    emit?.({
      type: "beads_comment_posted",
      issueId,
      round: params2.round,
      phase: params2.phase,
      bytes: Buffer.byteLength(params2.text, "utf8"),
    });
  }

  let userWaitsUsed = 0;
  async function maybeWaitForUser(params2: {
    round: number;
    phase: AgentResponse["phase"];
    questions: string[];
  }): Promise<void> {
    if (!params2.questions.length) return;
    if (userWaitSeconds <= 0) return;
    if (userWaitsUsed >= maxUserWaits) return;

    userWaitsUsed += 1;
    emit?.({
      type: "waiting_for_user",
      issueId,
      round: params2.round,
      phase: params2.phase,
      timeoutSeconds: userWaitSeconds,
      waitsUsed: userWaitsUsed,
      waitsMax: maxUserWaits,
      questions: params2.questions,
    });
    const beforeMaxId = maxBeadsCommentId(parseBeadsComments(await beadsListComments(issueId)));

    await postComment({
      round: params2.round,
      phase: params2.phase,
      text: [
        "---",
        `**SYSTEM** Input requested (wait ${userWaitSeconds}s, ${userWaitsUsed}/${maxUserWaits})`,
        "",
        "Please reply with a Beads comment that starts with `**USER**` on the first line, followed by your answer.",
        "",
        "Questions:",
        ...params2.questions.map((q) => `- ${q}`),
        "---",
      ].join("\n"),
    });

    const deadline = Date.now() + userWaitSeconds * 1000;
    while (Date.now() < deadline) {
      const comments = parseBeadsComments(await beadsListComments(issueId));
      const reply = findUserReplySince({ comments, afterId: beforeMaxId });
      if (reply) {
        emit?.({
          type: "user_input_received",
          issueId,
          round: params2.round,
          phase: params2.phase,
          message: reply.message,
        });
        return;
      }
      await new Promise((r) => setTimeout(r, userPollSeconds * 1000));
    }

    await postComment({
      round: params2.round,
      phase: params2.phase,
      text: `---\n**SYSTEM** No user response within ${userWaitSeconds}s; continuing.\n---`,
    });
    emit?.({ type: "user_input_timed_out", issueId, round: params2.round, phase: params2.phase, timeoutSeconds: userWaitSeconds });
  }

  for (let round = 1; round <= maxRounds; round++) {
    emit?.({ type: "phase_started", issueId, round, phase: "research" });
    await postComment({ round, phase: "research", text: `---\n**SYSTEM** Round ${round} starting (research)\n---` });
    const transcriptObj = await beadsListComments(issueId);
    const transcript = JSON.stringify(transcriptObj);
    const researchRepoContext = repoContextEnabled
      ? (await buildRepoContext({
          prompt,
          phase: "research",
          round,
          budgetBytes: repoContextBudgetBytes,
          maxMatches: repoContextMaxMatches,
          excerptRadiusLines: repoContextExcerptRadiusLines,
          log,
        })).text
      : "";

    const researchResponses: { provider: Provider; response: AgentResponse }[] = [];
    for (const provider of Object.keys(providers) as Provider[]) {
      let parsed: AgentResponse | null = null;
      try {
        await postComment({ round, phase: "research", text: `---\n**SYSTEM** Running \`${provider}\` (research)\n---` });
        parsed = await runProviderWithHeartbeat({
          issueId,
          provider,
          agentName: provider,
          round,
          phase: "research",
          prompt,
          transcript,
          repoContext: researchRepoContext,
          heartbeatSeconds,
          beadsHeartbeatSeconds,
          beadsHeartbeatMax,
          onBeadsHeartbeat: async (elapsedMs) => {
            await postComment({
              round,
              phase: "research",
              text: `---\n**SYSTEM** \`${provider}\` still running (${ms(elapsedMs)})\n---`,
            });
          },
          timeoutMs,
          log,
          onEvent: emit,
        });
      } catch (e: unknown) {
        await postComment({
          round,
          phase: "research",
          text: `---\n**SYSTEM** Provider failure: \`${provider}\` (research)\n\n\`\`\`\n${formatError(e)}\n\`\`\`\n---`,
        });
      }
      if (parsed) {
        const artifactRefs = await persistArtifacts({
          issueId,
          round,
          phase: "research",
          agentName: provider,
          artifacts: parsed.artifacts,
        });
        await postComment({ round, phase: "research", text: formatAgentComment({ provider, response: parsed, artifactRefs }) });
        researchResponses.push({ provider, response: parsed });
      }
    }

    if (!researchResponses.length) {
      await postComment({ round, phase: "research", text: `---\n**SYSTEM** No providers produced a research response; aborting.\n---` });
      throw new Error("All providers failed in research phase.");
    }

    const chair = pickChair(researchResponses);
    emit?.({ type: "phase_finished", issueId, round, phase: "research" });
    const researchQuestions = researchResponses.flatMap((r) => r.response.questions_for_user ?? []);
    await maybeWaitForUser({ round, phase: "research", questions: researchQuestions });
    emit?.({ type: "phase_started", issueId, round, phase: "critique" });
    await postComment({ round, phase: "critique", text: `---\n**SYSTEM** Chair selected: \`${chair}\` (critique)\n---` });

    const critiqueTranscriptObj = await beadsListComments(issueId);
    const critiqueTranscript = JSON.stringify(critiqueTranscriptObj);
    const critiqueRepoContext = repoContextEnabled
      ? (await buildRepoContext({
          prompt,
          phase: "critique",
          round,
          budgetBytes: repoContextBudgetBytes,
          maxMatches: repoContextMaxMatches,
          excerptRadiusLines: repoContextExcerptRadiusLines,
          log,
        })).text
      : "";
    const critiqueResponses: { provider: Provider; response: AgentResponse }[] = [];

    for (const provider of Object.keys(providers) as Provider[]) {
      let parsed: AgentResponse | null = null;
      try {
        await postComment({ round, phase: "critique", text: `---\n**SYSTEM** Running \`${provider}\` (critique)\n---` });
        parsed = await runProviderWithHeartbeat({
          issueId,
          provider,
          agentName: provider,
          round,
          phase: "critique",
          prompt,
          transcript: critiqueTranscript,
          repoContext: critiqueRepoContext,
          heartbeatSeconds,
          beadsHeartbeatSeconds,
          beadsHeartbeatMax,
          onBeadsHeartbeat: async (elapsedMs) => {
            await postComment({
              round,
              phase: "critique",
              text: `---\n**SYSTEM** \`${provider}\` still running (${ms(elapsedMs)})\n---`,
            });
          },
          timeoutMs,
          log,
          onEvent: emit,
        });
      } catch (e: unknown) {
        await postComment({
          round,
          phase: "critique",
          text: `---\n**SYSTEM** Provider failure: \`${provider}\` (critique)\n\n\`\`\`\n${formatError(e)}\n\`\`\`\n---`,
        });
      }
      if (parsed) {
        const artifactRefs = await persistArtifacts({
          issueId,
          round,
          phase: "critique",
          agentName: provider,
          artifacts: parsed.artifacts,
        });
        await postComment({ round, phase: "critique", text: formatAgentComment({ provider, response: parsed, artifactRefs }) });
        critiqueResponses.push({ provider, response: parsed });
      }
    }

    if (!critiqueResponses.length) {
      await postComment({ round, phase: "critique", text: `---\n**SYSTEM** No providers produced a critique response; aborting.\n---` });
      throw new Error("All providers failed in critique phase.");
    }

    let shouldContinue = critiqueResponses.some((r) => r.response.need_another_round);
    emit?.({ type: "phase_finished", issueId, round, phase: "critique" });
    const critiqueQuestions = critiqueResponses.flatMap((r) => r.response.questions_for_user ?? []);
    if (critiqueQuestions.length) shouldContinue = true;
    await maybeWaitForUser({ round, phase: "critique", questions: critiqueQuestions });
    emit?.({ type: "phase_started", issueId, round, phase: "synthesis" });
    await postComment({
      round,
      phase: "synthesis",
      text: `---\n**SYSTEM** Round ${round} synthesis (${shouldContinue ? "CONTINUE" : "DONE"})\n---`,
    });

    const synthTranscriptObj = await beadsListComments(issueId);
    const synthTranscript = JSON.stringify(synthTranscriptObj);
    const synthRepoContext = repoContextEnabled
      ? (await buildRepoContext({
          prompt,
          phase: "synthesis",
          round,
          budgetBytes: repoContextBudgetBytes,
          maxMatches: repoContextMaxMatches,
          excerptRadiusLines: repoContextExcerptRadiusLines,
          log,
        })).text
      : "";

    let synthesis: AgentResponse | null = null;
    let synthesisProvider: Provider | null = null;
    const synthCandidates = [
      chair,
      ...[...critiqueResponses]
        .sort((a, b) => b.response.chair_score - a.response.chair_score)
        .map((r) => r.provider)
        .filter((p) => p !== chair),
    ] as Provider[];
    const uniqueCandidates = [...new Set(synthCandidates)];

    for (const candidate of uniqueCandidates) {
      try {
        await postComment({ round, phase: "synthesis", text: `---\n**SYSTEM** Running chair \`${candidate}\` (synthesis)\n---` });
        synthesis = await runProviderWithHeartbeat({
          issueId,
          provider: candidate,
          agentName: `${candidate}-chair`,
          round,
          phase: "synthesis",
          prompt,
          transcript: synthTranscript,
          repoContext: synthRepoContext,
          heartbeatSeconds,
          beadsHeartbeatSeconds,
          beadsHeartbeatMax,
          onBeadsHeartbeat: async (elapsedMs) => {
            await postComment({
              round,
              phase: "synthesis",
              text: `---\n**SYSTEM** \`${candidate}\` still running (${ms(elapsedMs)})\n---`,
            });
          },
          timeoutMs,
          log,
          onEvent: emit,
        });
        synthesisProvider = candidate;
        break;
      } catch (e: unknown) {
        await postComment({
          round,
          phase: "synthesis",
          text: `---\n**SYSTEM** Chair failure: \`${candidate}\` (synthesis)\n\n\`\`\`\n${formatError(e)}\n\`\`\`\n---`,
        });
      }
    }

    if (!synthesis) {
      await postComment({ round, phase: "synthesis", text: `---\n**SYSTEM** No providers produced a synthesis response; aborting.\n---` });
      throw new Error("All providers failed in synthesis phase.");
    }

    const synthArtifactRefs = await persistArtifacts({
      issueId,
      round,
      phase: "synthesis",
      agentName: synthesis.agent,
      artifacts: synthesis.artifacts,
    });
    await postComment({
      round,
      phase: "synthesis",
      text: formatAgentComment({
        provider: synthesisProvider ?? chair,
        response: synthesis,
        artifactRefs: synthArtifactRefs,
      }),
    });
    emit?.({ type: "phase_finished", issueId, round, phase: "synthesis" });

    const synthQuestions = synthesis.questions_for_user ?? [];
    if (synthQuestions.length) {
      shouldContinue = true;
      await maybeWaitForUser({ round, phase: "synthesis", questions: synthQuestions });
    }

    if (!shouldContinue) {
      await postComment({ round, phase: null, text: `---\n**SYSTEM** Session converged after round ${round}.\n---` });
      return;
    }
  }

  await postComment({ round: null, phase: null, text: `---\n**SYSTEM** Max rounds reached; stopping.\n---` });
}
