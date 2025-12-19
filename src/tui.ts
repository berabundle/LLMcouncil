import blessed from "neo-blessed";
import { beadsListComments, beadsAddComment } from "./beads.js";
import { parseBeadsComments } from "./beads_comments.js";
import { findLatestIssuePlanFile, loadIssuePlanFromFile } from "./plan_storage.js";
import { createDevIssuesFromPlan } from "./plan_apply.js";
import type { BeadsIssuePlan } from "./plan.js";

type TuiParams = {
  issueId: string;
  pollSeconds?: number;
  tailComments?: number;
  statusLine?: () => string;
  waitingState?: () =>
    | {
        active: boolean;
        questions: string[];
        untilMs: number | null;
      }
    | null;
  onRequestPlan?: () => Promise<void>;
};

export async function runTui(params: TuiParams): Promise<void> {
  await new Promise<void>((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      title: "council",
    });

    const status = blessed.box({
      top: 0,
      left: 0,
      width: "100%",
      height: 4,
      border: { type: "line" },
      tags: true,
      content: `Issue: ${params.issueId}  (q/Esc/Ctrl+C to quit)`,
    });

    const transcript = blessed.log({
      top: 4,
      left: 0,
      width: "100%",
      height: "100%-7",
      border: { type: "line" },
      tags: true,
      scrollable: true,
      keys: true,
      vi: true,
      alwaysScroll: true,
      scrollbar: { ch: " " },
      mouse: true,
      label: " Transcript ",
    });

    const input = blessed.textbox({
      bottom: 0,
      left: 0,
      width: "100%",
      height: 3,
      border: { type: "line" },
      keys: true,
      inputOnFocus: true,
      mouse: true,
      label: " Send (**USER**) (Enter to submit) ",
    });

    const waiting = blessed.box({
      top: "center",
      left: "center",
      width: "80%",
      height: 10,
      border: { type: "line" },
      tags: true,
      hidden: true,
      label: " Awaiting User Input ",
      content: "",
    });

    const planModal = blessed.box({
      top: "center",
      left: "center",
      width: "90%",
      height: "80%",
      border: { type: "line" },
      tags: true,
      hidden: true,
      scrollable: true,
      keys: true,
      vi: true,
      alwaysScroll: true,
      label: " Plan Review ",
      content: "",
    });

    screen.append(status);
    screen.append(transcript);
    screen.append(input);
    screen.append(waiting);
    screen.append(planModal);

    let lastSeenId = 0;
    let stopped = false;
    let pendingPlan: { councilIssueId: string; planPath: string; plan: BeadsIssuePlan } | null = null;
    const pollSeconds = params.pollSeconds ?? 2;
    const tailComments = params.tailComments ?? 200;

    async function refreshOnce(): Promise<void> {
      const raw = await beadsListComments(params.issueId);
      const comments = parseBeadsComments(raw).sort((a, b) => a.id - b.id);
      const sliced = tailComments > 0 ? comments.slice(Math.max(0, comments.length - tailComments)) : comments;
      for (const c of sliced) {
        if (c.id <= lastSeenId) continue;
        lastSeenId = c.id;
        transcript.log(`\n#${c.id}\n${c.text}\n`);
      }
    }

    async function pollLoop(): Promise<void> {
      while (!stopped) {
        try {
          await refreshOnce();
          const extra = params.statusLine?.();
          status.setContent(
            [
              `Issue: ${params.issueId}  (poll ${pollSeconds}s)  last comment: #${lastSeenId}  (q/Esc/Ctrl+C to quit)`,
              extra ? extra.trimEnd() : "",
            ]
              .filter(Boolean)
              .join("\n"),
          );

          const waitState = params.waitingState?.();
          if (waitState?.active) {
            const remaining =
              typeof waitState.untilMs === "number" ? Math.max(0, Math.ceil((waitState.untilMs - Date.now()) / 1000)) : null;
            const header = remaining != null ? `Time remaining: ${remaining}s` : "Time remaining: unknown";
            waiting.setContent([header, "", "Questions:", ...waitState.questions.map((q) => `- ${q}`)].join("\n"));
            waiting.show();
          } else {
            waiting.hide();
          }
        } catch (e: unknown) {
          status.setContent(
            `Issue: ${params.issueId}  ERROR: ${e instanceof Error ? e.message : String(e)}  (q/Esc/Ctrl+C to quit)`,
          );
        }
        screen.render();
        await new Promise((r) => setTimeout(r, pollSeconds * 1000));
      }
    }

    screen.key(["q", "escape", "C-c"], () => {
      stopped = true;
      screen.destroy();
      resolve();
    });

    screen.key(["C-p"], () => {
      if (!params.onRequestPlan) return;
      transcript.log("\n[plan] requested\n");
      void params
        .onRequestPlan()
        .then(() => transcript.log("\n[plan] finished\n"))
        .catch((e: unknown) => transcript.log(`\n[plan] error: ${e instanceof Error ? e.message : String(e)}\n`))
        .finally(() => screen.render());
    });

    screen.key(["C-i"], () => {
      void (async () => {
        transcript.log("\n[plan] loading latest plan artifact…\n");
        const planPath = await findLatestIssuePlanFile(params.issueId);
        if (!planPath) {
          transcript.log("[plan] no beads_issue_plan.json found under .council/artifacts for this issue\n");
          screen.render();
          return;
        }
        const loaded = await loadIssuePlanFromFile(planPath);
        if (!loaded.ok) {
          transcript.log(`[plan] parse error: ${loaded.error}\n`);
          screen.render();
          return;
        }

        pendingPlan = { councilIssueId: params.issueId, planPath, plan: loaded.value };
        const plan = loaded.value;
        const lines: string[] = [];
        lines.push(`File: ${planPath}`);
        lines.push("");
        lines.push(`Issues: ${plan.issues.length}`);
        lines.push("");
        for (const [i, issue] of plan.issues.entries()) {
          lines.push(`${String(i + 1).padStart(2, "0")}. ${issue.title}`);
          lines.push(`    priority: ${issue.priority || "2"}  labels: ${(issue.labels || []).join(", ") || "-"}`);
          if (issue.depends_on?.length) lines.push(`    depends_on: ${issue.depends_on.join(", ")}`);
          lines.push(`    acceptance: ${issue.acceptance || "-"}`);
          lines.push("");
        }
        lines.push("Confirm: press 'y' to create dev issues in repo root .beads/, or 'n' to cancel.");

        planModal.setContent(lines.join("\n"));
        planModal.show();
        planModal.focus();
        screen.render();
      })();
    });

    screen.key(["n"], () => {
      if (planModal.hidden) return;
      pendingPlan = null;
      planModal.hide();
      input.focus();
      screen.render();
    });

    screen.key(["y"], () => {
      if (planModal.hidden) return;
      const pending = pendingPlan;
      if (!pending) return;
      pendingPlan = null;
      planModal.hide();
      input.focus();
      transcript.log("\n[plan] creating dev issues…\n");
      void createDevIssuesFromPlan({ councilIssueId: pending.councilIssueId, plan: pending.plan })
        .then((result) => {
          transcript.log(`[plan] created ${result.created.length} dev issues:\n`);
          for (const c of result.created) transcript.log(`- ${c.id}: ${c.title}`);
        })
        .catch((e: unknown) => {
          transcript.log(`\n[plan] create error: ${e instanceof Error ? e.message : String(e)}\n`);
        })
        .finally(() => screen.render());
    });

    input.on("submit", async (value: string) => {
      const msg = value.trim();
      input.clearValue();
      screen.render();
      if (!msg) return;
      try {
        await beadsAddComment(params.issueId, `**USER**\n${msg}\n`);
      } catch (e: unknown) {
        transcript.log(`\n[send error] ${e instanceof Error ? e.message : String(e)}\n`);
      } finally {
        input.focus();
        screen.render();
      }
    });

    screen.key(["enter"], () => {
      if (screen.focused === input) {
        input.submit();
        return;
      }
      input.focus();
    });

    input.focus();
    screen.render();
    void pollLoop();
  });
}
