import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function devDbArgs(): string[] {
  const dbPath = process.env.DEV_BD_DB || path.join(".beads", "beads.db");
  return ["--db", dbPath];
}

async function bd(args: string[], input?: string): Promise<{ stdout: string }> {
  const res = await execa("bd", [...devDbArgs(), ...args], { input, stdout: "pipe", stderr: "pipe" });
  return { stdout: res.stdout };
}

export async function devBeadsCreateIssue(params: {
  title: string;
  description: string;
  acceptance?: string;
  labels?: string[];
  priority?: string;
  type?: "task" | "bug" | "feature" | "epic" | "chore";
}): Promise<string> {
  const args = ["create", params.title, "-d", params.description];
  if (params.acceptance) args.push("--acceptance", params.acceptance);
  if (params.labels?.length) args.push("-l", params.labels.join(","));
  if (params.priority) args.push("-p", params.priority);
  if (params.type) args.push("-t", params.type);
  args.push("--json");
  const res = await execa("bd", [...devDbArgs(), ...args], { stdout: "pipe", stderr: "pipe" });
  const parsed = JSON.parse(res.stdout) as { id?: string };
  if (!parsed.id) throw new Error(`bd create did not return an id: ${res.stdout}`);
  return parsed.id;
}

export async function devBeadsAddComment(issueId: string, text: string): Promise<void> {
  const tmpDir = path.join(".council", "tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `dev-beads-comment-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.md`);
  await fs.writeFile(tmpPath, text, "utf8");
  try {
    await bd(["comments", "add", issueId, "-f", tmpPath]);
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

export async function devBeadsAddDependency(params: {
  issueId: string;
  dependsOnId: string;
  type?: "blocks" | "related" | "parent-child" | "discovered-from";
}): Promise<void> {
  const args = ["dep", "add", params.issueId, params.dependsOnId];
  if (params.type) args.push("-t", params.type);
  await bd(args);
}

