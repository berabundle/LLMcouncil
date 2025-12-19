import { execa } from "execa";
import { agentResponseJsonSchemaString, parseAgentResponse } from "../schema.js";
import { extractFirstJsonObject, tryParseJson } from "../util/json.js";
import type { ProviderRun } from "./types.js";
import { providerProfilesForPrompt } from "./profiles.js";

export const runClaude: ProviderRun = async ({ agentName, round, phase, prompt, transcript, repoContext, timeoutMs }) => {
  const schema = agentResponseJsonSchemaString();
  const repoBlock = repoContext?.trim() ? [repoContext.trim(), ""] : [];
  const fullPrompt = [
    `You are council agent: ${agentName}.`,
    `Return ONLY valid JSON matching the provided JSON Schema.`,
    `Set: agent="${agentName}", round=${round}, phase="${phase}".`,
    `Use "message" for your discussion. Keep it concise and specific.`,
    `If you need user input, set "questions_for_user" to a non-empty array.`,
    `If you proceed without user input, capture assumptions in "assumptions".`,
    `Important: Always include "why_continue" (use "" if none).`,
    `Important: Every artifact MUST include "mime" and "suggested_filename" (use "" if unknown).`,
    `Do not use tools.`,
    "",
    providerProfilesForPrompt(),
    "",
    ...repoBlock,
    "=== User Prompt ===",
    prompt,
    "",
    "=== Beads Transcript (for context) ===",
    transcript,
    "",
    "Output JSON only.",
  ].join("\n");

  const res = await execa("claude", ["--print", "--output-format", "json", "--model", "sonnet", "--tools", "", "--json-schema", schema, "--", fullPrompt], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });

  const raw = res.stdout.trim();
  const top = tryParseJson(raw);
  const structured =
    top && typeof top === "object" && top !== null && "structured_output" in top
      ? (top as { structured_output?: unknown }).structured_output
      : null;
  const extracted = structured ?? extractFirstJsonObject(raw);
  if (!extracted) throw new Error(`Claude output was not JSON.\n${raw}`);

  const parsed = parseAgentResponse(extracted);
  return { raw, parsed };
};
