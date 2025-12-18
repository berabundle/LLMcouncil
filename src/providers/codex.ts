import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentResponseSchema } from "../schema.js";
import { extractFirstJsonObject, tryParseJson } from "../util/json.js";
import type { ProviderRun } from "./types.js";
import { providerProfilesForPrompt } from "./profiles.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function repoRootFromHere(): string {
  return path.resolve(__dirname, "..", "..");
}

export const runCodex: ProviderRun = async ({ agentName, round, phase, prompt, transcript }) => {
  const repoRoot = repoRootFromHere();
  const schemaPath = path.join(repoRoot, ".council", "schema", "agent_response.schema.json");
  const tmpDir = path.join(repoRoot, ".council", "tmp");
  const lastMessagePath = path.join(tmpDir, `codex-last-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);

  const fullPrompt = [
    `You are council agent: ${agentName}.`,
    `Return ONLY valid JSON matching the provided JSON Schema.`,
    `Set: agent="${agentName}", round=${round}, phase="${phase}".`,
    `Important: Always include "why_continue" (use "" if none).`,
    `Important: Every artifact MUST include "mime" and "suggested_filename" (use "" if unknown).`,
    "",
    providerProfilesForPrompt(),
    "",
    "=== User Prompt ===",
    prompt,
    "",
    "=== Beads Transcript (for context) ===",
    transcript,
    "",
    "Output JSON only.",
  ].join("\n");

  const res = await execa(
    "codex",
    [
      "exec",
      "--sandbox",
      "read-only",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      lastMessagePath,
      "--skip-git-repo-check",
      fullPrompt,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const rawText = String(await fs.readFile(lastMessagePath, "utf8").catch(() => res.stdout)).trim();
  const direct = tryParseJson(rawText);
  const extracted = direct ?? extractFirstJsonObject(rawText);
  if (!extracted) throw new Error(`Codex output was not JSON.\n${rawText}`);

  const parsed = AgentResponseSchema.parse(extracted);
  return { raw: rawText, parsed };
};
