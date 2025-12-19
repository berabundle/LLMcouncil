import fs from "node:fs/promises";
import path from "node:path";
import type { BeadsIssuePlan } from "./plan.js";
import { parseBeadsIssuePlanArtifact } from "./plan.js";

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (e.isFile()) {
      files.push(full);
    }
  }
  return files;
}

export async function findLatestIssuePlanFile(issueId: string): Promise<string | null> {
  const base = path.join(".council", "artifacts", issueId);
  const files = await walk(base);
  const candidates = files.filter((p) => path.basename(p) === "beads_issue_plan.json");
  if (!candidates.length) return null;

  let best: { path: string; mtimeMs: number } | null = null;
  for (const p of candidates) {
    const st = await fs.stat(p).catch(() => null);
    if (!st) continue;
    if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs };
  }
  return best?.path ?? null;
}

export async function loadIssuePlanFromFile(planPath: string): Promise<{ ok: true; value: BeadsIssuePlan } | { ok: false; error: string }> {
  const content = await fs.readFile(planPath, "utf8").catch((e: unknown) => {
    throw new Error(`Failed to read plan file: ${e instanceof Error ? e.message : String(e)}`);
  });
  const parsed = parseBeadsIssuePlanArtifact({
    type: "beads_issue_plan",
    title: "beads_issue_plan",
    content,
    mime: "application/json",
    suggested_filename: "beads_issue_plan.json",
  });
  return parsed;
}

