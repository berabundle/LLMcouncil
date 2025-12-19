# Architecture (MVP)

## Components

- **CLI** (`src/index.ts`): parses commands and starts/continues a session.
- **Round engine** (`src/engine.ts`): runs multi-agent rounds until convergence or `maxRounds`.
- **TUI** (`src/tui.ts`): neo-blessed UI for live transcript + user replies (and plan review).
- **Providers** (`src/providers/*`): adapters that call local CLIs (`codex`, `claude`, `gemini`) and normalize outputs.
- **Beads integration** (`src/beads.ts`): creates issues and appends comments (transcript) in the council Beads DB (`.council/.beads/`).
- **Repo context** (`src/repo_context.ts`): scoped, on-demand context builder (rg + excerpts) injected into provider prompts.
- **Dev tracker** (`.beads/`): separate Beads DB for developing this repo (not used by the council engine).
- **Artifacts store** (`.council/artifacts/`): optional local persistence for large or typed artifacts.
- **Plan mode** (`src/plan_mode.ts`): asks a chair to emit a `beads_issue_plan` artifact and posts it to the session.

## Protocol

Each agent response is JSON conforming to `src/schema.ts` (same shape across providers).

### Rounds

1. **Research**: each agent independently analyzes the user prompt and emits structured output.
2. **Critique**: each agent critiques others and signals whether another round is needed.
3. **Synthesis**: the auto-chair produces a final synthesis (or requests another round / Oracle escalation).

### User input pauses

If any agent emits `questions_for_user`, the engine can pause briefly awaiting a `**USER**` comment (configurable timeout and max pauses), then continue.
