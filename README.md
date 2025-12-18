# LLMcouncil

Beads-first multi-model council CLI for Codex + Claude + Gemini (with optional Oracle escalation).

## Prereqs

- `bd` (Beads) on PATH
- `codex`, `claude`, `gemini` on PATH and authenticated

## Install

```bash
npm install
npm run build
```

## Usage

Create a new “council session” as a Beads issue and let the council deliberate:

```bash
node dist/index.js consult "What should we build next?"
```

Or run in dev:

```bash
npm run dev -- consult "…"
```

The transcript is stored as Beads comments on the created issue (plus any local artifacts under `.council/artifacts/`).

## Beads workflow

- Beads uses a local SQLite DB (`.beads/beads.db`) plus a syncable JSONL export (`.beads/issues.jsonl`).
- After running sessions, export/sync with:

```bash
bd sync
```
