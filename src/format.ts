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

  lines.push(mdEscape(response.message).trim() || "(empty)");

  if (response.questions_for_user.length) {
    lines.push("");
    lines.push("**Questions For User**");
    lines.push(response.questions_for_user.map((q) => `- ${mdEscape(q)}`).join("\n"));
  }

  if (response.assumptions.length) {
    lines.push("");
    lines.push("**Assumptions**");
    lines.push(response.assumptions.map((a) => `- ${mdEscape(a)}`).join("\n"));
  }

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
