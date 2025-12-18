#!/usr/bin/env node
import { Command } from "commander";
import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import { beadsCreateIssue } from "./beads.js";
import { runCouncilSession } from "./engine.js";

async function ensureDirs(): Promise<void> {
  await fs.mkdir(path.join(".council", "tmp"), { recursive: true });
  await fs.mkdir(path.join(".council", "artifacts"), { recursive: true });
}

const program = new Command();

program.name("council").description("Beads-first multi-model council CLI (Codex/Claude/Gemini)");

program
  .command("doctor")
  .description("Check local prerequisites (bd/codex/claude/gemini)")
  .action(async () => {
    const cmds = ["bd", "codex", "claude", "gemini"];
    const results: { cmd: string; ok: boolean; where?: string; version?: string; error?: string }[] = [];
    for (const cmd of cmds) {
      try {
        const which = await execa("bash", ["-lc", `command -v ${cmd}`], { stdout: "pipe", stderr: "pipe" });
        const where = which.stdout.trim();
        let version = "";
        try {
          const v = await execa(cmd, ["--version"], { stdout: "pipe", stderr: "pipe" });
          version = (v.stdout || v.stderr).trim();
        } catch {
          // ignore
        }
        results.push({ cmd, ok: true, where, version });
      } catch (e: unknown) {
        results.push({ cmd, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(results, null, 2));
  });

program
  .command("consult")
  .argument("<prompt...>", "User prompt for the council")
  .option("--max-rounds <n>", "Maximum rounds before stopping", "5")
  .action(async (promptParts: string[], opts: { maxRounds: string }) => {
    await ensureDirs();
    const prompt = promptParts.join(" ").trim();
    const maxRounds = Number.parseInt(opts.maxRounds, 10);
    if (!Number.isFinite(maxRounds) || maxRounds <= 0) throw new Error("--max-rounds must be a positive integer");

    const issueId = await beadsCreateIssue({
      title: prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt,
      description: `Council session\n\nPrompt:\n${prompt}\n`,
      labels: ["council", "session"],
      priority: "2",
    });

    // Print issue id for quick linking / continuing.
    // eslint-disable-next-line no-console
    console.log(issueId);

    await runCouncilSession({ issueId, prompt, maxRounds });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
