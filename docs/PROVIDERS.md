# Providers (CLIs) and Strengths

This council runs via local CLI tools, not direct API calls. Each provider is treated as a peer, and the chair is selected automatically each round.

## Shared operating rule

Each agent should lean into their strengths and explicitly delegate:
- If you’re unsure, say what you’d need to decide.
- If another provider is better suited, say so and explain why.
- When you disagree, state the crux and what evidence would resolve it.

## Codex CLI (OpenAI)

- Upstream: https://github.com/openai/codex
- Best at:
  - Codebase-aware analysis and implementation planning
  - Safe automation patterns (sandbox + approvals model)
  - Producing structured outputs (schemas), repeatable workflows
- Watchouts:
  - If a task needs web-grounded facts, explicitly ask Gemini to verify.

## Claude Code (Anthropic)

- Upstream: https://github.com/anthropics/claude-code
- Best at:
  - Careful reasoning, writing, and critique
  - Requirements clarification and surfacing hidden assumptions
  - High-signal reviews (architecture, API design, edge cases)
- Watchouts:
  - If factual/web claims matter, request Gemini grounding and cite sources.

## Gemini CLI (Google)

- Upstream: https://github.com/google-gemini/gemini-cli
- Best at:
  - Web-grounded research (Google Search grounding)
  - Large-context synthesis, long docs, multimodal inputs
  - Generating artifacts (diagrams, structured plans) to be critiqued by others
- Watchouts:
  - If the output is a plan that will be executed, ask Codex/Claude to sanity-check for correctness/safety.

## Oracle (steipete) — escalation tool

- Upstream: https://github.com/steipete/oracle
- Purpose in this repo:
  - “Bring in GPT Pro / multi-model heavyweight review” when the council agrees it’s missing key info or needs deeper cross-checking.
  - Bundle the prompt + relevant files so the escalation model has real context (and can search within the bundle).
- Watchouts:
  - Treat as a scoped escalation: ask a precise question and attach only the needed files.

## README snapshots

Snapshots are stored in `docs/vendor/` so agents can reference CLI capabilities offline:
- `docs/vendor/codex-cli.README.md`
- `docs/vendor/claude-code.README.md`
- `docs/vendor/gemini-cli.README.md`
- `docs/vendor/oracle.README.md`

