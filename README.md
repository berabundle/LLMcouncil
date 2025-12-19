# LLMcouncil

Beads-first multi-model council CLI for Codex + Claude + Gemini (with optional Oracle escalation).

## Prereqs

- `bd` (Beads) on PATH
- `codex`, `claude`, `gemini` on PATH and authenticated
- Optional (viewer): `bv` (beads_viewer)

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

Or launch the interactive TUI and run the session in-process:

```bash
node dist/index.js tui-consult "What should we build next?"
```

Or run in dev:

```bash
npm run dev -- consult "…"
```

The transcript is stored as Beads comments on the created issue (plus any local artifacts under `.council/artifacts/`).

## Two Beads databases

This repo intentionally has two separate Beads stores:

- **Dev tracker** (for building this repo): `.beads/` in repo root
- **Council sessions** (transcripts/artifacts): `.council/.beads/`

The council CLI writes to the council DB by default (`COUNCIL_BD_DB` overrides).

## Watching a session

After `consult`, you’ll get an issue id like `council-abc`.

- CLI tailer: `node dist/index.js watch council-abc`
- TUI: `node dist/index.js tui council-abc`
- Raw transcript: `cd .council && bd comments council-abc`
- TUI viewer: `cd .council && bv`

## TUI keys (WIP)

- `Enter`: focus the input box
- `Ctrl+P`: request “plan mode” (asks the chair to emit a `beads_issue_plan` artifact)
- `Ctrl+I`: open latest plan + confirm creating dev issues (`y`/`n`)

## Beads sync workflow

- Beads uses a local SQLite DB plus a syncable JSONL export (`issues.jsonl`).
- Sync dev tracker (repo root):

```bash
bd sync
```

- Sync council sessions:

```bash
cd .council
bd sync
```
