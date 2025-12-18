# Architecture (MVP)

## Components

- **CLI** (`src/index.ts`): parses commands and starts/continues a session.
- **Round engine** (`src/engine.ts`): runs multi-agent rounds until convergence or `maxRounds`.
- **Providers** (`src/providers/*`): adapters that call local CLIs (`codex`, `claude`, `gemini`) and normalize outputs.
- **Beads integration** (`src/beads.ts`): creates issues and appends comments (transcript).
- **Artifacts store** (`.council/artifacts/`): optional local persistence for large or typed artifacts.

## Protocol

Each agent response is JSON conforming to `src/schema.ts` (same shape across providers).

### Rounds

1. **Research**: each agent independently analyzes the user prompt and emits structured output.
2. **Critique**: each agent critiques others and signals whether another round is needed.
3. **Synthesis**: the auto-chair produces a final synthesis (or requests another round / Oracle escalation).

