import { execa } from "execa";
import { AgentResponseSchema } from "../schema.js";
import { extractFirstJsonObject, tryParseJson } from "../util/json.js";
import type { ProviderRun } from "./types.js";

export const runGemini: ProviderRun = async ({ agentName, round, phase, prompt, transcript }) => {
  const fullPrompt = [
    `You are council agent: ${agentName}.`,
    `Return ONLY valid JSON.`,
    `JSON must have keys: agent, round, phase, summary, recommendations, risks, open_questions, need_another_round, why_continue, chair_score, chair_reason, artifacts.`,
    `Set: agent="${agentName}", round=${round}, phase="${phase}".`,
    "",
    "=== User Prompt ===",
    prompt,
    "",
    "=== Beads Transcript (for context) ===",
    transcript,
    "",
    "Output JSON only.",
  ].join("\n");

  const res = await execa("gemini", ["--output-format", "text", "--sandbox", fullPrompt], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const raw = res.stdout.trim();
  const direct = tryParseJson(raw);
  const extracted = direct ?? extractFirstJsonObject(raw);
  if (!extracted) throw new Error(`Gemini output was not JSON.\n${raw}`);

  const parsed = AgentResponseSchema.parse(extracted);
  return { raw, parsed };
};

