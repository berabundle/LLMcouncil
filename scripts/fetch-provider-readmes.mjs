import fs from "node:fs/promises";
import path from "node:path";

const targets = [
  {
    out: "codex-cli.README.md",
    urls: ["https://raw.githubusercontent.com/openai/codex/main/README.md"],
  },
  {
    out: "claude-code.README.md",
    urls: ["https://raw.githubusercontent.com/anthropics/claude-code/main/README.md"],
  },
  {
    out: "gemini-cli.README.md",
    urls: ["https://raw.githubusercontent.com/google-gemini/gemini-cli/main/README.md"],
  },
  {
    out: "oracle.README.md",
    urls: ["https://raw.githubusercontent.com/steipete/oracle/main/README.md"],
  },
];

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed ${res.status} for ${url}`);
  return await res.text();
}

function header(url) {
  return [
    "<!--",
    "  Auto-generated snapshot.",
    `  Source: ${url}`,
    `  Fetched: ${new Date().toISOString()}`,
    "  Notes: This is truncated to keep the repo small; use the Source URL for the full README.",
    "-->",
    "",
  ].join("\n");
}

const outDir = path.join(process.cwd(), "docs", "vendor");
await fs.mkdir(outDir, { recursive: true });

for (const t of targets) {
  let content = null;
  let source = null;
  let lastError = null;
  for (const url of t.urls) {
    try {
      content = await fetchText(url);
      source = url;
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!content || !source) throw lastError ?? new Error(`No source worked for ${t.out}`);

  const lines = content.replaceAll("\r\n", "\n").split("\n").slice(0, 220).join("\n");
  await fs.writeFile(path.join(outDir, t.out), header(source) + lines + "\n", "utf8");
}

console.log(`Wrote snapshots to ${outDir}`);

