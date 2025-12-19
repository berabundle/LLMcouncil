import type { BeadsIssuePlan } from "./plan.js";
import { devBeadsAddDependency, devBeadsCreateIssue } from "./dev_beads.js";

export async function createDevIssuesFromPlan(params: {
  councilIssueId: string;
  plan: BeadsIssuePlan;
}): Promise<{
  created: { title: string; id: string }[];
  titleToId: Record<string, string>;
}> {
  const titleToId: Record<string, string> = {};
  const created: { title: string; id: string }[] = [];

  for (const issue of params.plan.issues) {
    const description = `${issue.description.trim()}\n\n---\nFrom council session: ${params.councilIssueId}\n`;
    const id = await devBeadsCreateIssue({
      title: issue.title,
      description,
      acceptance: issue.acceptance || "",
      labels: issue.labels,
      priority: issue.priority || "2",
      type: "task",
    });
    titleToId[issue.title] = id;
    created.push({ title: issue.title, id });
  }

  // Second pass: wire dependencies. Interpret `depends_on` values as titles within the same plan.
  for (const issue of params.plan.issues) {
    const issueId = titleToId[issue.title];
    if (!issueId) continue;
    for (const depTitle of issue.depends_on ?? []) {
      const dependsOnId = titleToId[depTitle];
      if (!dependsOnId) continue;
      await devBeadsAddDependency({ issueId, dependsOnId, type: "blocks" });
    }
  }

  return { created, titleToId };
}

