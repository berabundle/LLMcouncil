# Agent Playbook

Practical guidelines for working as the coding agent across projects.

## Mission

- Deliver accurate answers or code changes with minimal churn.
- Follow instruction priority: system → developer → user → repo docs.
- Preserve existing work; never undo user edits without clear approval.

## Operating Principles

- **Think first**: gather context before editing; use quick searches instead of scanning whole files.
- **Plan when it helps**: craft a lightweight plan for anything non-trivial; skip it for obvious one-off edits.
- **Keep diffs tight**: prefer focused changes, avoid drive-by refactors, and match the project’s style.
- **Validate**: run the smallest meaningful check (tests, lints, scripts); if you cannot, state why and suggest how.
- **Document decisions**: explain non-obvious intent in concise comments or commit notes when needed.
- **Report clearly**: summarize outcomes, list affected files with line references, and offer next logical steps only when they add value.
- **Ask before assuming**: don't add fallbacks or fabricate data when blocked; pause and ask the user for the needed details, explaining what is missing.

## Best Practices

- Use tooling expected by the project (package managers, test runners) instead of ad-hoc commands.
- Rely on evidence from logs, stack traces, or tests before fixing bugs—no guessing.
- Avoid destructive commands unless the user explicitly requests them.
- Keep communication concise, collaborative, and actionable.
- Update this playbook when recurring patterns emerge so the next session starts from a better baseline.
- Maintain clear, centralized logs with consistent severity levels so issues can be tailed and diagnosed quickly.
- Use a temporary scratchpad (e.g., `docs/scratch.md`) for complex tasks to capture context and decisions; tidy or archive it when done.
- Break work into small, composable modules with clear interfaces so future agents (and LLMs) can reason about them quickly.
- Keep file-level headers or module docstrings current—they should explain purpose, dependencies, and how to extend the code safely.
- Replace magic numbers with named constants or configuration values to keep intent transparent.
- Source every environment-specific setting from an `.env` file and document expected keys.
- Structure `.env` files into logical sections with comments so dependencies and secrets are easy to spot.
- Maintain a running changelog that records user-visible behaviour changes for continuity between sessions.
- Write comments as definitive descriptions (no transitional phrasing like “enhanced” or “replaced”); avoid TODOs unless explicitly agreed.
- Assume the operator is LLM-only—deliver end-to-end instructions that require no extra coding knowledge.

## Task Tracking (Beads)

If a repo has a `.beads/` directory, use `bd` as the task tracker (instead of ad-hoc markdown plans).

- Find ready work: `bd ready`
- Create/update tasks: `bd create "Title" -p 1`, `bd show <id>`, `bd update <id> --status in_progress`
- Capture dependencies: `bd dep add <child> <parent>`
- After changing issues: run `bd sync` so `.beads/issues.jsonl` is exported/committed/pushed (if configured)

Optional: use Beads Viewer (`bv`) for triage/graph insights on Beads data.

- Install (no sudo): `curl -fsSL "https://raw.githubusercontent.com/Dicklesworthstone/beads_viewer/main/install.sh?$(date +%s)" | bash`
- Agents: use only robot mode (non-interactive JSON), e.g. `bv --robot-triage`, `bv --robot-plan`, `bv --robot-next` (bare `bv` launches an interactive TUI and will block)

## Error Handling

Prefer result-based error handling over exception-based flow control for business logic. This makes failure modes explicit in function signatures and improves reasoning about error paths.

### When to Use Result Types

**DO use Result[T, E] for:**
- New business logic where failures are expected (validation, resource not found, etc.)
- Service layer methods with predictable failure modes
- Operations where callers need to handle errors explicitly
- Functions where the signature should document what can go wrong

**Example (Preferred):**
```python
from sjbot.core.result import Result, Ok, Err

def get_wallet_balance(self) -> Result[Dict[str, Any], str]:
    """Fetch wallet balance from exchange API."""
    try:
        response = self.client.get("/accounts", auth=True)
        payload = response.json()
        if payload.get("result") != "success":
            return Err(f"Exchange returned error: {payload.get('error')}")
        accounts = payload.get("accounts")
        if not accounts:
            return Err("No accounts found in response")
        return Ok(accounts)
    except httpx.HTTPError as e:
        return Err(f"HTTP request failed: {e}")
```

**Calling code:**
```python
result = service.get_wallet_balance()
if result.is_ok():
    balance = result.unwrap()
    logger.info("Balance: %s", balance)
else:
    error = result.unwrap_err()
    logger.error("Failed to fetch balance: %s", error)
    return  # Handle gracefully
```

### When Exceptions Are Acceptable

**Exceptions are fine for:**
- Wrapping third-party libraries that raise exceptions (httpx, SQLAlchemy, etc.)
- Truly exceptional conditions (programming errors, system failures)
- Top-level error boundaries and retry logic
- Infrastructure code where propagating detailed errors isn't useful

**Example (Acceptable):**
```python
@retry(wait=wait_exponential(multiplier=1, min=1, max=8), stop=stop_after_attempt(5))
def get(self, path: str, params: Dict[str, Any] | None = None) -> httpx.Response:
    """Issue HTTP GET request with automatic retry (raises on failure)."""
    response = self.client.get(path, params=params)  # May raise httpx.HTTPError
    response.raise_for_status()  # Let exception propagate for retry logic
    return response
```

### Migration Strategy

**For existing code:**
1. DO NOT refactor working error handling without clear value
2. Add Result types to NEW code and NEW functions
3. Consider Result types when touching existing service methods IF:
   - The function has clear, documented failure modes
   - Callers currently catch and handle specific errors
   - Tests already cover error paths
   - The change is isolated and low-risk

**Incremental adoption:**
- Start with leaf functions (no dependencies)
- Move up the call stack as needed
- Keep HTTP/DB wrappers exception-based unless there's clear benefit
- Prioritize code clarity over dogmatic adherence

### Result Type Utilities

Available in `sjbot/core/result.py`:
- `Result[T, E]`: Union type for Ok[T] | Err[E]
- `Ok(value)`: Success variant
- `Err(error)`: Error variant
- `try_result(fn)`: Wrap exception-throwing code in Result
- Methods: `is_ok()`, `is_err()`, `unwrap()`, `unwrap_or()`, `map()`, `and_then()`

See module docstring for detailed usage examples.

## Toolbelt

These CLI tools are typically available on the host and worth using:

- `ripgrep` (`rg`) for fast code search.
- `fd-find` (`fd`) for quick file discovery.
- `jq` for JSON inspection.
- `httpie` for readable HTTP requests.
- `wget` (`apt install wget`) to mirror doc sites: `wget --mirror --convert-links --adjust-extension --no-parent https://example.com/docs/`.
- `lynx` (`apt install lynx`) for quick text dumps: `lynx -dump -nolist -nonumbers https://example.com/docs/ > docs.txt`.
- `pandoc` (`apt install pandoc`) to convert HTML into Markdown: `curl -sL https://example.com/docs/ | pandoc -f html -t gfm -o docs/tmp_scrape/docs.md`.
- `playwright` (`pipx install playwright && playwright install chromium`) to render SPA docs before conversion.
- `fzf` for fuzzy search across files, history, and git.
- `just` for lightweight task automation.
- `bat` for syntax-highlighted file previews.
- `entr` for rerunning commands on file changes.
- `btop` / `glances` for live system monitoring.
- `lnav` for interactive log exploration.
- `tmux` for managing parallel terminal sessions efficiently.
- `oracle` / `oracle-mcp` (`npm install -g @steipete/oracle`) bundles a prompt + files so another model can answer with real repo context (API via `OPENAI_API_KEY`/`GEMINI_API_KEY`/`ANTHROPIC_API_KEY`, or browser via ChatGPT/Gemini in Chrome).
  - Chrome on this host: `--browser-chrome-path /usr/bin/google-chrome-stable` and cookies at `~/.config/google-chrome/Default/Cookies`.
  - If cookie reuse fails (common when keyring/DBus access is restricted), use manual login once: `oracle --engine browser --browser-no-cookie-sync --browser-manual-login -p "…"`, sign into `https://chatgpt.com/` in the opened Chrome window, then rerun the same command (it reuses the Oracle automation profile).
  - Use when stuck/bugs/reviewing; `oracle --render --copy-markdown …` is the reliable “manual paste” path.
  - Run `oracle --help` once per session before first use.

Example SPA docs scrape:

```bash
python - <<'PY'
from pathlib import Path
from playwright.sync_api import sync_playwright

url = "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api"
html_path = Path("docs/tmp_scrape/hyperliquid_api.html")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto(url, wait_until="networkidle")
    html_path.write_text(page.content(), encoding="utf8")
    browser.close()
PY
pandoc docs/tmp_scrape/hyperliquid_api.html -f html -t gfm -o docs/tmp_scrape/hyperliquid_api.md
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

<!-- bv-agent-instructions-v1 -->

---

## Beads Workflow Integration

This project uses [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) for issue tracking. Issues are stored in `.beads/` and tracked in git.

### Essential Commands

```bash
# View issues (launches TUI - avoid in automated sessions)
bv

# CLI commands for agents (use these instead)
bd ready              # Show issues ready to work (no blockers)
bd list --status=open # All open issues
bd show <id>          # Full issue details with dependencies
bd create --title="..." --type=task --priority=2
bd update <id> --status=in_progress
bd close <id> --reason="Completed"
bd close <id1> <id2>  # Close multiple issues at once
bd sync               # Commit and push changes
```

### Workflow Pattern

1. **Start**: Run `bd ready` to find actionable work
2. **Claim**: Use `bd update <id> --status=in_progress`
3. **Work**: Implement the task
4. **Complete**: Use `bd close <id>`
5. **Sync**: Always run `bd sync` at session end

### Key Concepts

- **Dependencies**: Issues can block other issues. `bd ready` shows only unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers, not words)
- **Types**: task, bug, feature, epic, question, docs
- **Blocking**: `bd dep add <issue> <depends-on>` to add dependencies

### Session Protocol

**Before ending any session, run this checklist:**

```bash
git status              # Check what changed
git add <files>         # Stage code changes
bd sync                 # Commit beads changes
git commit -m "..."     # Commit code
bd sync                 # Commit any new beads changes
git push                # Push to remote
```

### Best Practices

- Check `bd ready` at session start to find available work
- Update status as you work (in_progress → closed)
- Create new issues with `bd create` when you discover tasks
- Use descriptive titles and set appropriate priority/type
- Always `bd sync` before ending session

<!-- end-bv-agent-instructions -->

Note: Use `~` for home paths instead of usernames (for example `~/Projects/...`).
