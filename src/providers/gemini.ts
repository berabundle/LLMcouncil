import { execa } from "execa";
import { parseAgentResponse } from "../schema.js";
import { extractFirstJsonObject, tryParseJson } from "../util/json.js";
import type { ProviderRun } from "./types.js";
import { providerProfilesForPrompt } from "./profiles.js";

export const runGemini: ProviderRun = async ({ agentName, round, phase, prompt, transcript, repoContext, timeoutMs }) => {
  const repoBlock = repoContext?.trim() ? [repoContext.trim(), ""] : [];
  const fullPrompt = [
    `You are council agent: ${agentName}.`,
    `Return ONLY valid JSON.`,
    `JSON must have keys: agent, round, phase, message, questions_for_user, assumptions, need_another_round, why_continue, chair_score, chair_reason, artifacts.`,
    `Field types must be: questions_for_user/assumptions/artifacts are arrays (use [] if empty).`,
    `need_another_round must be boolean. chair_score must be a number 0..10.`,
    `Important: Always include "why_continue" (use "" if none).`,
    `Important: Every artifact MUST include "mime" and "suggested_filename" (use "" if unknown).`,
    `Do not use tools.`,
    `Set: agent="${agentName}", round=${round}, phase="${phase}".`,
    `Use "message" for your discussion. Keep it concise and specific.`,
    `If you need user input, set "questions_for_user" to a non-empty array.`,
    `If you proceed without user input, capture assumptions in "assumptions".`,
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

  // NOTE: `--sandbox` requires docker/podman; avoid it by default.
  // Use JSON output and parse the `response` field to avoid interleaved logs.
  const res = await execa("gemini", ["--output-format", "json", "--approval-mode", "yolo", "-e", "none", fullPrompt], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
    env: {
      ...process.env,
      GEMINI_SANDBOX: "false",
    },
  });

  const raw = res.stdout.trim();
  const top = tryParseJson(raw) as { response?: unknown } | null;
  const responseText = top && typeof top.response === "string" ? (top.response as string) : raw;
  const direct = tryParseJson(responseText);
  const extracted = direct ?? extractFirstJsonObject(responseText);
  if (!extracted) throw new Error(`Gemini output was not JSON.\n${responseText}`);

  const parsed = parseAgentResponse(extracted);
  return { raw, parsed };
};
