import { execa } from "execa";
import { AgentResponseSchema, agentResponseJsonSchemaString } from "../schema.js";
import { extractFirstJsonObject, tryParseJson } from "../util/json.js";
import type { ProviderRun } from "./types.js";

export const runClaude: ProviderRun = async ({ agentName, round, phase, prompt, transcript }) => {
  const schema = agentResponseJsonSchemaString();
  const fullPrompt = [
    `You are council agent: ${agentName}.`,
    `Return ONLY valid JSON matching the provided JSON Schema.`,
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

  const res = await execa("claude", ["--print", "--output-format", "text", "--tools", "", "--json-schema", schema, fullPrompt], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const raw = res.stdout.trim();
  const direct = tryParseJson(raw);
  const extracted = direct ?? extractFirstJsonObject(raw);
  if (!extracted) throw new Error(`Claude output was not JSON.\n${raw}`);

  const parsed = AgentResponseSchema.parse(extracted);
  return { raw, parsed };
};

