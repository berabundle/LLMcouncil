import type { AgentResponse, Artifact } from "./schema.js";

function mdEscape(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

export function formatAgentComment(params: {
  provider: string;
  response: AgentResponse;
  artifactRefs: { artifact: Artifact; savedPath: string }[];
}): string {
  const { provider, response, artifactRefs } = params;

  const lines: string[] = [];
  lines.push(`**Agent**: \`${mdEscape(response.agent)}\`  **Provider**: \`${provider}\``);
  lines.push(`**Round**: \`${response.round}\`  **Phase**: \`${response.phase}\``);
  lines.push("");
  lines.push("**Summary**");
  lines.push(mdEscape(response.summary) || "(empty)");
  lines.push("");
  lines.push("**Recommendations**");
  lines.push(response.recommendations.length ? response.recommendations.map((r) => `- ${mdEscape(r)}`).join("\n") : "- (none)");
  lines.push("");
  lines.push("**Risks**");
  lines.push(response.risks.length ? response.risks.map((r) => `- ${mdEscape(r)}`).join("\n") : "- (none)");
  lines.push("");
  lines.push("**Open Questions**");
  lines.push(
    response.open_questions.length ? response.open_questions.map((q) => `- ${mdEscape(q)}`).join("\n") : "- (none)",
  );
  lines.push("");
  lines.push(`**Chair Score**: \`${response.chair_score}\` — ${mdEscape(response.chair_reason)}`);
  lines.push(`**Continue?**: \`${response.need_another_round ? "CONTINUE" : "DONE"}\` ${mdEscape(response.why_continue ?? "")}`);

  if (artifactRefs.length) {
    lines.push("");
    lines.push("**Artifacts**");
    for (const { artifact, savedPath } of artifactRefs) {
      lines.push(`- \`${artifact.type}\`: ${mdEscape(artifact.title)} → \`${savedPath}\``);
    }
  }

  return lines.join("\n");
}

