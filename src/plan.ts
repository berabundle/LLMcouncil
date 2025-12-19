import { z } from "zod";
import type { Artifact } from "./schema.js";

export const BeadsIssuePlanIssueSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  acceptance: z.string().optional().default(""),
  priority: z.string().optional().default("2"),
  labels: z.array(z.string()).optional().default([]),
  depends_on: z.array(z.string()).optional().default([]),
  assignee: z.string().optional().default(""),
});

export type BeadsIssuePlanIssue = z.infer<typeof BeadsIssuePlanIssueSchema>;

export const BeadsIssuePlanSchema = z.object({
  version: z.literal(1).optional().default(1),
  issues: z.array(BeadsIssuePlanIssueSchema).min(1),
});

export type BeadsIssuePlan = z.infer<typeof BeadsIssuePlanSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseBeadsIssuePlanArtifact(artifact: Artifact): ParseResult<BeadsIssuePlan> {
  if (artifact.type !== "beads_issue_plan") return { ok: false, error: `Unsupported artifact type: ${artifact.type}` };
  const raw = artifact.content.trim();
  if (!raw) return { ok: false, error: "Empty beads_issue_plan artifact content" };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (e: unknown) {
    return { ok: false, error: `beads_issue_plan content is not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const parsed = BeadsIssuePlanSchema.safeParse(obj);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, value: parsed.data };
}

