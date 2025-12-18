import fs from "node:fs/promises";
import path from "node:path";
import type { Artifact } from "./schema.js";

function sanitizeFilename(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 80);
}

function defaultExtension(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("mermaid")) return "mmd";
  if (t.includes("markdown")) return "md";
  if (t.includes("json")) return "json";
  if (t.includes("svg")) return "svg";
  if (t.includes("html")) return "html";
  return "txt";
}

export async function persistArtifacts(params: {
  issueId: string;
  round: number;
  phase: string;
  agentName: string;
  artifacts: Artifact[];
}): Promise<{ artifact: Artifact; savedPath: string }[]> {
  const { issueId, round, phase, agentName, artifacts } = params;
  if (!artifacts.length) return [];

  const baseDir = path.join(".council", "artifacts", issueId, `round-${round}`, phase, sanitizeFilename(agentName));
  await fs.mkdir(baseDir, { recursive: true });

  const refs: { artifact: Artifact; savedPath: string }[] = [];
  for (const [index, artifact] of artifacts.entries()) {
    const suggested = artifact.suggested_filename ? sanitizeFilename(artifact.suggested_filename) : "";
    const titlePart = sanitizeFilename(artifact.title);
    const ext = suggested.includes(".") ? "" : `.${defaultExtension(artifact.type)}`;
    const filename = suggested || `${String(index + 1).padStart(2, "0")}-${titlePart || "artifact"}${ext}`;
    const fullPath = path.join(baseDir, filename);
    await fs.writeFile(fullPath, artifact.content, "utf8");
    refs.push({ artifact, savedPath: fullPath });
  }

  return refs;
}

