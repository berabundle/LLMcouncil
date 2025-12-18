import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

async function bd(args: string[], input?: string): Promise<{ stdout: string }> {
  const res = await execa("bd", args, { input, stdout: "pipe", stderr: "pipe" });
  return { stdout: res.stdout };
}

export async function beadsCreateIssue(params: {
  title: string;
  description: string;
  labels?: string[];
  priority?: string;
}): Promise<string> {
  const args = ["create", params.title, "-d", params.description];
  if (params.labels?.length) args.push("-l", params.labels.join(","));
  if (params.priority) args.push("-p", params.priority);
  args.push("--json");

  const res = await execa("bd", args, { stdout: "pipe", stderr: "pipe" });
  const parsed = JSON.parse(res.stdout) as { id?: string };
  if (!parsed.id) throw new Error(`bd create did not return an id: ${res.stdout}`);
  return parsed.id;
}

export async function beadsAddComment(issueId: string, text: string): Promise<void> {
  const tmpDir = path.join(".council", "tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `beads-comment-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.md`);
  await fs.writeFile(tmpPath, text, "utf8");
  try {
    await bd(["comments", "add", issueId, "-f", tmpPath]);
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

export async function beadsListComments(issueId: string): Promise<unknown> {
  const res = await execa("bd", ["comments", issueId, "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return JSON.parse(res.stdout);
}
