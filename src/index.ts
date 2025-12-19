#!/usr/bin/env node
import { Command } from "commander";
import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import { beadsAddComment, beadsCreateIssue } from "./beads.js";
import { runCouncilSession } from "./engine.js";
import { probeProviders } from "./probe.js";
import { runPlanMode } from "./plan_mode.js";
import { runTui } from "./tui.js";

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
  .command("probe")
  .description("Run a short non-interactive test prompt against each provider")
  .option("--providers <list>", "Comma-separated providers (codex,claude,gemini)", "codex,claude,gemini")
  .option("--timeout-seconds <n>", "Per-provider timeout in seconds", "30")
  .option("--prompt <text>", "Probe prompt", "Say OK and list 3 bullets.")
  .action(async (opts: { providers: string; timeoutSeconds: string; prompt: string }) => {
    await ensureDirs();
    const timeoutSeconds = Number.parseInt(opts.timeoutSeconds, 10);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error("--timeout-seconds must be a positive integer");

    const requested = opts.providers
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const allowed = new Set(["codex", "claude", "gemini"]);
    const selected = requested.filter((p) => allowed.has(p));
    if (!selected.length) throw new Error("No valid providers selected. Use: codex,claude,gemini");

    const results = await probeProviders({
      providers: selected as ("codex" | "claude" | "gemini")[],
      prompt: opts.prompt,
      timeoutSeconds,
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(results, null, 2));
  });

program
  .command("tui")
  .description("Launch the interactive TUI (WIP)")
  .argument("<issueId>", "Council issue id (e.g. council-abc)")
  .option("--poll-seconds <n>", "Polling interval seconds", "2")
  .option("--tail-comments <n>", "Show only the last N comments (0 = all)", "200")
  .action(async (issueId: string, opts: { pollSeconds: string; tailComments: string }) => {
    await ensureDirs();
    const pollSeconds = Number.parseInt(opts.pollSeconds, 10);
    if (!Number.isFinite(pollSeconds) || pollSeconds <= 0) throw new Error("--poll-seconds must be a positive integer");
    const tailComments = Number.parseInt(opts.tailComments, 10);
    if (!Number.isFinite(tailComments) || tailComments < 0) throw new Error("--tail-comments must be an integer >= 0");
    await runTui({ issueId, pollSeconds, tailComments });
  });

program
  .command("tui-consult")
  .description("Create a council session and open the interactive TUI")
  .argument("<prompt...>", "User prompt for the council")
  .option("--max-rounds <n>", "Maximum rounds before stopping", "5")
  .option("--heartbeat-seconds <n>", "Print a heartbeat while a provider runs (0 disables)", "15")
  .option("--beads-heartbeat-seconds <n>", "Post a low-rate heartbeat comment to Beads while a provider runs (0 disables)", "60")
  .option("--beads-heartbeat-max <n>", "Max heartbeat comments per provider run", "5")
  .option("--timeout-seconds <n>", "Per-provider timeout in seconds", "600")
  .option("--user-wait-seconds <n>", "Wait up to N seconds for a `**USER**` reply when the council asks (0 disables)", "60")
  .option("--max-user-waits <n>", "Max number of user-wait pauses per session", "2")
  .option("--user-poll-seconds <n>", "Polling interval seconds while awaiting user input", "2")
  .option("--no-repo-context", "Disable scoped repo context gathering for provider prompts")
  .option("--repo-context-budget-bytes <n>", "Max bytes of repo context to include per phase", "12000")
  .option("--repo-context-max-matches <n>", "Max ripgrep matches to consider for context", "40")
  .option("--repo-context-excerpt-radius <n>", "Excerpt radius lines around each match", "2")
  .option("--tui-poll-seconds <n>", "TUI polling interval seconds", "2")
  .option("--tui-tail-comments <n>", "TUI shows only the last N comments (0 = all)", "200")
  .action(async (promptParts: string[], opts: Record<string, string | boolean>) => {
    await ensureDirs();
    const prompt = promptParts.join(" ").trim();
    const maxRounds = Number.parseInt(String(opts.maxRounds), 10);
    if (!Number.isFinite(maxRounds) || maxRounds <= 0) throw new Error("--max-rounds must be a positive integer");
    const heartbeatSeconds = Number.parseInt(String(opts.heartbeatSeconds), 10);
    if (!Number.isFinite(heartbeatSeconds) || heartbeatSeconds < 0)
      throw new Error("--heartbeat-seconds must be an integer >= 0");
    const beadsHeartbeatSeconds = Number.parseInt(String(opts.beadsHeartbeatSeconds), 10);
    if (!Number.isFinite(beadsHeartbeatSeconds) || beadsHeartbeatSeconds < 0)
      throw new Error("--beads-heartbeat-seconds must be an integer >= 0");
    const beadsHeartbeatMax = Number.parseInt(String(opts.beadsHeartbeatMax), 10);
    if (!Number.isFinite(beadsHeartbeatMax) || beadsHeartbeatMax <= 0)
      throw new Error("--beads-heartbeat-max must be a positive integer");
    const timeoutSeconds = Number.parseInt(String(opts.timeoutSeconds), 10);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error("--timeout-seconds must be a positive integer");
    const userWaitSeconds = Number.parseInt(String(opts.userWaitSeconds), 10);
    if (!Number.isFinite(userWaitSeconds) || userWaitSeconds < 0)
      throw new Error("--user-wait-seconds must be an integer >= 0");
    const maxUserWaits = Number.parseInt(String(opts.maxUserWaits), 10);
    if (!Number.isFinite(maxUserWaits) || maxUserWaits < 0) throw new Error("--max-user-waits must be an integer >= 0");
    const userPollSeconds = Number.parseInt(String(opts.userPollSeconds), 10);
    if (!Number.isFinite(userPollSeconds) || userPollSeconds <= 0)
      throw new Error("--user-poll-seconds must be a positive integer");
    const repoContextBudgetBytes = Number.parseInt(String(opts.repoContextBudgetBytes), 10);
    if (!Number.isFinite(repoContextBudgetBytes) || repoContextBudgetBytes < 0)
      throw new Error("--repo-context-budget-bytes must be an integer >= 0");
    const repoContextMaxMatches = Number.parseInt(String(opts.repoContextMaxMatches), 10);
    if (!Number.isFinite(repoContextMaxMatches) || repoContextMaxMatches < 0)
      throw new Error("--repo-context-max-matches must be an integer >= 0");
    const repoContextExcerptRadiusLines = Number.parseInt(String(opts.repoContextExcerptRadius), 10);
    if (!Number.isFinite(repoContextExcerptRadiusLines) || repoContextExcerptRadiusLines < 0)
      throw new Error("--repo-context-excerpt-radius must be an integer >= 0");
    const tuiPollSeconds = Number.parseInt(String(opts.tuiPollSeconds), 10);
    if (!Number.isFinite(tuiPollSeconds) || tuiPollSeconds <= 0) throw new Error("--tui-poll-seconds must be a positive integer");
    const tuiTailComments = Number.parseInt(String(opts.tuiTailComments), 10);
    if (!Number.isFinite(tuiTailComments) || tuiTailComments < 0) throw new Error("--tui-tail-comments must be an integer >= 0");

    const issueId = await beadsCreateIssue({
      title: prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt,
      description: `Council session\n\nPrompt:\n${prompt}\n`,
      labels: ["council", "session"],
      priority: "2",
    });

    const engineState: {
      phase: string;
      provider: string;
      providerPhase: string;
      providerStartedAtMs: number | null;
      waiting: boolean;
      waitingUntilMs: number | null;
      waitingQuestions: string[];
    } = {
      phase: "idle",
      provider: "",
      providerPhase: "",
      providerStartedAtMs: null,
      waiting: false,
      waitingUntilMs: null,
      waitingQuestions: [],
    };

    const sessionPromise = runCouncilSession({
      issueId,
      prompt,
      maxRounds,
      heartbeatSeconds,
      beadsHeartbeatSeconds,
      beadsHeartbeatMax,
      timeoutSeconds,
      userWaitSeconds,
      maxUserWaits,
      userPollSeconds,
      repoContextEnabled: Boolean(opts.repoContext),
      repoContextBudgetBytes,
      repoContextMaxMatches,
      repoContextExcerptRadiusLines,
      onEvent: (ev) => {
        if (ev.type === "phase_started") {
          engineState.phase = ev.phase;
          engineState.waiting = false;
          engineState.waitingUntilMs = null;
          engineState.waitingQuestions = [];
        } else if (ev.type === "provider_started") {
          engineState.provider = ev.provider;
          engineState.providerPhase = ev.phase;
          engineState.providerStartedAtMs = Date.now();
          engineState.waiting = false;
          engineState.waitingUntilMs = null;
          engineState.waitingQuestions = [];
        } else if (ev.type === "provider_finished") {
          engineState.provider = "";
          engineState.providerPhase = "";
          engineState.providerStartedAtMs = null;
        } else if (ev.type === "waiting_for_user") {
          engineState.waiting = true;
          engineState.waitingQuestions = Array.isArray(ev.questions) ? ev.questions : [];
          engineState.waitingUntilMs =
            typeof ev.timeoutSeconds === "number" && Number.isFinite(ev.timeoutSeconds) ? Date.now() + ev.timeoutSeconds * 1000 : null;
        } else if (ev.type === "user_input_received" || ev.type === "user_input_timed_out") {
          engineState.waiting = false;
          engineState.waitingUntilMs = null;
          engineState.waitingQuestions = [];
        }
      },
    }).catch(async (e: unknown) => {
      await beadsAddComment(
        issueId,
        `---\n**SYSTEM** Engine error\n\n\`\`\`\n${e instanceof Error ? e.message : String(e)}\n\`\`\`\n---`,
      ).catch(() => undefined);
    });

    await runTui({
      issueId,
      pollSeconds: tuiPollSeconds,
      tailComments: tuiTailComments,
      statusLine: () => {
        const parts: string[] = [];
        parts.push(`Phase: ${engineState.phase}${engineState.waiting ? " (awaiting user)" : ""}`);
        if (engineState.provider) {
          const elapsed = engineState.providerStartedAtMs ? Math.floor((Date.now() - engineState.providerStartedAtMs) / 1000) : 0;
          parts.push(`Provider: ${engineState.provider} (${engineState.providerPhase}) ${elapsed}s`);
        }
        return parts.join("  ");
      },
      waitingState: () => ({
        active: engineState.waiting,
        questions: engineState.waitingQuestions,
        untilMs: engineState.waitingUntilMs,
      }),
      onRequestPlan: async () => {
        await runPlanMode({
          issueId,
          provider: "codex",
          timeoutSeconds,
          repoContextEnabled: Boolean(opts.repoContext),
          repoContextBudgetBytes,
          repoContextMaxMatches,
          repoContextExcerptRadiusLines,
        });
      },
    });
    void sessionPromise;
  });

program
  .command("consult")
  .argument("<prompt...>", "User prompt for the council")
  .option("--max-rounds <n>", "Maximum rounds before stopping", "5")
  .option("--heartbeat-seconds <n>", "Print a heartbeat while a provider runs (0 disables)", "15")
  .option("--beads-heartbeat-seconds <n>", "Post a low-rate heartbeat comment to Beads while a provider runs (0 disables)", "60")
  .option("--beads-heartbeat-max <n>", "Max heartbeat comments per provider run", "5")
  .option("--timeout-seconds <n>", "Per-provider timeout in seconds", "600")
  .option("--user-wait-seconds <n>", "Wait up to N seconds for a `**USER**` reply when the council asks (0 disables)", "60")
  .option("--max-user-waits <n>", "Max number of user-wait pauses per session", "2")
  .option("--user-poll-seconds <n>", "Polling interval seconds while awaiting user input", "2")
  .option("--no-repo-context", "Disable scoped repo context gathering for provider prompts")
  .option("--repo-context-budget-bytes <n>", "Max bytes of repo context to include per phase", "12000")
  .option("--repo-context-max-matches <n>", "Max ripgrep matches to consider for context", "40")
  .option("--repo-context-excerpt-radius <n>", "Excerpt radius lines around each match", "2")
  .action(
    async (
      promptParts: string[],
      opts: {
        maxRounds: string;
        heartbeatSeconds: string;
        beadsHeartbeatSeconds: string;
        beadsHeartbeatMax: string;
        timeoutSeconds: string;
        userWaitSeconds: string;
        maxUserWaits: string;
        userPollSeconds: string;
        repoContext: boolean;
        repoContextBudgetBytes: string;
        repoContextMaxMatches: string;
        repoContextExcerptRadius: string;
      },
    ) => {
    await ensureDirs();
    const prompt = promptParts.join(" ").trim();
    const maxRounds = Number.parseInt(opts.maxRounds, 10);
    if (!Number.isFinite(maxRounds) || maxRounds <= 0) throw new Error("--max-rounds must be a positive integer");
    const heartbeatSeconds = Number.parseInt(opts.heartbeatSeconds, 10);
    if (!Number.isFinite(heartbeatSeconds) || heartbeatSeconds < 0)
      throw new Error("--heartbeat-seconds must be an integer >= 0");
    const beadsHeartbeatSeconds = Number.parseInt(opts.beadsHeartbeatSeconds, 10);
    if (!Number.isFinite(beadsHeartbeatSeconds) || beadsHeartbeatSeconds < 0)
      throw new Error("--beads-heartbeat-seconds must be an integer >= 0");
    const beadsHeartbeatMax = Number.parseInt(opts.beadsHeartbeatMax, 10);
    if (!Number.isFinite(beadsHeartbeatMax) || beadsHeartbeatMax <= 0)
      throw new Error("--beads-heartbeat-max must be a positive integer");
    const timeoutSeconds = Number.parseInt(opts.timeoutSeconds, 10);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error("--timeout-seconds must be a positive integer");
    const userWaitSeconds = Number.parseInt(opts.userWaitSeconds, 10);
    if (!Number.isFinite(userWaitSeconds) || userWaitSeconds < 0)
      throw new Error("--user-wait-seconds must be an integer >= 0");
    const maxUserWaits = Number.parseInt(opts.maxUserWaits, 10);
    if (!Number.isFinite(maxUserWaits) || maxUserWaits < 0) throw new Error("--max-user-waits must be an integer >= 0");
    const userPollSeconds = Number.parseInt(opts.userPollSeconds, 10);
    if (!Number.isFinite(userPollSeconds) || userPollSeconds <= 0)
      throw new Error("--user-poll-seconds must be a positive integer");
    const repoContextBudgetBytes = Number.parseInt(opts.repoContextBudgetBytes, 10);
    if (!Number.isFinite(repoContextBudgetBytes) || repoContextBudgetBytes < 0)
      throw new Error("--repo-context-budget-bytes must be an integer >= 0");
    const repoContextMaxMatches = Number.parseInt(opts.repoContextMaxMatches, 10);
    if (!Number.isFinite(repoContextMaxMatches) || repoContextMaxMatches < 0)
      throw new Error("--repo-context-max-matches must be an integer >= 0");
    const repoContextExcerptRadiusLines = Number.parseInt(opts.repoContextExcerptRadius, 10);
    if (!Number.isFinite(repoContextExcerptRadiusLines) || repoContextExcerptRadiusLines < 0)
      throw new Error("--repo-context-excerpt-radius must be an integer >= 0");

    const issueId = await beadsCreateIssue({
      title: prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt,
      description: `Council session\n\nPrompt:\n${prompt}\n`,
      labels: ["council", "session"],
      priority: "2",
    });

    // Print issue id for quick linking / continuing.
    // eslint-disable-next-line no-console
    console.log(issueId);
    // eslint-disable-next-line no-console
    console.error(`[council] Session: ${issueId}`);
    // eslint-disable-next-line no-console
    console.error(
      `[council] Watch: (cd .council && bd comments ${issueId}) (or: watch -n 1 'cd .council && bd comments ${issueId} | tail -n 80')`,
    );

    await runCouncilSession({
      issueId,
      prompt,
      maxRounds,
      heartbeatSeconds,
      beadsHeartbeatSeconds,
      beadsHeartbeatMax,
      timeoutSeconds,
      userWaitSeconds,
      maxUserWaits,
      userPollSeconds,
      repoContextEnabled: opts.repoContext,
      repoContextBudgetBytes,
      repoContextMaxMatches,
      repoContextExcerptRadiusLines,
    });
  },
);

program
  .command("watch")
  .description("Tail a council issue transcript (polls `bd comments` against the council Beads DB)")
  .argument("<issueId>", "Council issue id (e.g. council-abc)")
  .option("--interval-seconds <n>", "Polling interval seconds", "2")
  .option("--tail <n>", "Print only the last N lines", "120")
  .option("--once", "Print once and exit", false)
  .action(async (issueId: string, opts: { intervalSeconds: string; tail: string; once: boolean }) => {
    const intervalSeconds = Number.parseInt(opts.intervalSeconds, 10);
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0)
      throw new Error("--interval-seconds must be a positive integer");
    const tail = Number.parseInt(opts.tail, 10);
    if (!Number.isFinite(tail) || tail <= 0) throw new Error("--tail must be a positive integer");

    const dbPath = process.env.COUNCIL_BD_DB || path.join(".council", ".beads", "beads.db");

    while (true) {
      const res = await execa("bd", ["--db", dbPath, "comments", issueId], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const lines = res.stdout.split("\n");
      const out = lines.length > tail ? lines.slice(lines.length - tail).join("\n") : res.stdout;
      // eslint-disable-next-line no-console
      console.clear();
      // eslint-disable-next-line no-console
      console.log(`[council] ${issueId} @ ${new Date().toISOString()} (tail ${tail})\n`);
      // eslint-disable-next-line no-console
      console.log(out);
      if (opts.once) return;
      await new Promise((r) => setTimeout(r, intervalSeconds * 1000));
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
