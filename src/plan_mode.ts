import type { AgentResponse } from "./schema.js";
import { beadsAddComment, beadsListComments } from "./beads.js";
import { persistArtifacts } from "./artifacts.js";
import { formatAgentComment } from "./format.js";
import { runCodex } from "./providers/codex.js";
import { runClaude } from "./providers/claude.js";
import { runGemini } from "./providers/gemini.js";
import { buildRepoContext } from "./repo_context.js";

type Provider = "codex" | "claude" | "gemini";

const providers: Record<Provider, typeof runCodex> = {
  codex: runCodex,
  claude: runClaude as unknown as typeof runCodex,
  gemini: runGemini as unknown as typeof runCodex,
};

export async function runPlanMode(params: {
  issueId: string;
  provider?: Provider;
  timeoutSeconds?: number;
  repoContextEnabled?: boolean;
  repoContextBudgetBytes?: number;
  repoContextMaxMatches?: number;
  repoContextExcerptRadiusLines?: number;
  log?: (line: string) => void;
}): Promise<void> {
  const provider = params.provider ?? "codex";
  const timeoutMs = (params.timeoutSeconds ?? 600) * 1000;
  const log = params.log ?? (() => undefined);

  await beadsAddComment(params.issueId, `---\n**SYSTEM** Plan mode requested (provider: \`${provider}\`)\n---`);
  const transcriptObj = await beadsListComments(params.issueId);
  const transcript = JSON.stringify(transcriptObj);

  const repoContextEnabled = params.repoContextEnabled ?? true;
  const repoContextBudgetBytes = params.repoContextBudgetBytes ?? 12_000;
  const repoContextMaxMatches = params.repoContextMaxMatches ?? 40;
  const repoContextExcerptRadiusLines = params.repoContextExcerptRadiusLines ?? 2;
  const repoContext = repoContextEnabled
    ? (await buildRepoContext({
        prompt: "Generate a Beads issue plan for this repo.",
        phase: "oracle",
        round: 1,
        budgetBytes: repoContextBudgetBytes,
        maxMatches: repoContextMaxMatches,
        excerptRadiusLines: repoContextExcerptRadiusLines,
        log,
      })).text
    : "";

  const planSchemaText = JSON.stringify(
    {
      version: 1,
      issues: [
        {
          title: "string",
          description: "string",
          acceptance: "string (optional)",
          priority: "0-4 or P0-P4 (optional, default 2)",
          labels: ["string"] as string[],
          depends_on: ["issue-id"] as string[],
          assignee: "string (optional)",
        },
      ],
    },
    null,
    2,
  );

  const planPrompt = [
    "You are the council chair in PLAN MODE.",
    "Return JSON matching the provided schema.",
    'You MUST include exactly one artifact: type="beads_issue_plan".',
    'Set artifact.suggested_filename="beads_issue_plan.json" and mime="application/json".',
    "",
    "The artifact.content MUST be valid JSON matching this shape (use real values):",
    planSchemaText,
    "",
    "Write a short discussion in `message`, but put all actionable work into the artifact.",
    "If you need clarifications, put them in `questions_for_user`.",
  ].join("\n");

  const runner = providers[provider];
  const { parsed } = await runner({
    agentName: `${provider}-plan-chair`,
    round: 1,
    phase: "oracle" satisfies AgentResponse["phase"],
    prompt: planPrompt,
    transcript,
    repoContext,
    timeoutMs,
  });

  const artifactRefs = await persistArtifacts({
    issueId: params.issueId,
    round: 1,
    phase: "oracle",
    agentName: parsed.agent,
    artifacts: parsed.artifacts,
  });
  await beadsAddComment(params.issueId, formatAgentComment({ provider, response: parsed, artifactRefs }));
}
