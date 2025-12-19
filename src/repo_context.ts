import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";

export type RepoContextPhase = "research" | "critique" | "synthesis" | "oracle";

export type RepoContextParams = {
  prompt: string;
  phase: RepoContextPhase;
  round: number;
  budgetBytes: number;
  maxMatches: number;
  excerptRadiusLines: number;
  log?: (line: string) => void;
};

export type RepoContextResult = {
  text: string;
  refs: { file: string; line: number }[];
  truncated: boolean;
};

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "into",
  "your",
  "you",
  "are",
  "was",
  "were",
  "will",
  "would",
  "could",
  "should",
  "have",
  "has",
  "had",
  "how",
  "what",
  "why",
  "when",
  "where",
  "which",
  "can",
  "cant",
  "not",
  "use",
  "using",
  "make",
  "build",
]);

function extractKeywords(prompt: string): string[] {
  const words = prompt
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => w.length >= 4)
    .filter((w) => !STOPWORDS.has(w));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 8) break;
  }
  return out;
}

async function repoRoot(): Promise<string> {
  try {
    const res = await execa("git", ["rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "pipe" });
    return res.stdout.trim() || process.cwd();
  } catch {
    return process.cwd();
  }
}

function clampTextByBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return { text, truncated: false };
  // Conservative truncation: trim to ~maxBytes characters, then back off.
  let end = Math.min(text.length, maxBytes);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > maxBytes) end = Math.floor(end * 0.9);
  return { text: text.slice(0, end).trimEnd() + "\n\n[context truncated]\n", truncated: true };
}

async function excerptForMatch(params: { absPath: string; line: number; radius: number }): Promise<string> {
  const raw = await fs.readFile(params.absPath, "utf8").catch(() => "");
  if (!raw) return "";
  const lines = raw.replaceAll("\r\n", "\n").split("\n");
  const index = Math.max(1, params.line);
  const start = Math.max(1, index - params.radius);
  const end = Math.min(lines.length, index + params.radius);
  const out: string[] = [];
  for (let i = start; i <= end; i++) {
    out.push(`${String(i).padStart(4, " ")}: ${lines[i - 1] ?? ""}`);
  }
  return out.join("\n");
}

export async function buildRepoContext(params: RepoContextParams): Promise<RepoContextResult> {
  const log = params.log ?? (() => undefined);
  const keywords = extractKeywords(params.prompt);
  if (!keywords.length || params.budgetBytes <= 0 || params.maxMatches <= 0) {
    return { text: "", refs: [], truncated: false };
  }

  const root = await repoRoot();
  const rgQuery = keywords.length === 1 ? keywords[0] : `(${keywords.map((k) => k.replaceAll(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")).join("|")})`;

  const rgArgs = [
    "--no-heading",
    "--color",
    "never",
    "-n",
    "-S",
    "--glob",
    "!node_modules/**",
    "--glob",
    "!.council/**",
    "--glob",
    "!dist/**",
    rgQuery,
    ".",
  ];

  let rgOut = "";
  try {
    const res = await execa("rg", rgArgs, { cwd: root, stdout: "pipe", stderr: "pipe" });
    rgOut = res.stdout;
  } catch (e: unknown) {
    // rg returns exit code 1 when no matches; treat as empty.
    const anyErr = e as { exitCode?: number; stdout?: string };
    rgOut = typeof anyErr.stdout === "string" ? anyErr.stdout : "";
  }

  const matches = rgOut
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, params.maxMatches);

  const refs: { file: string; line: number }[] = [];
  const blocks: string[] = [];
  blocks.push("=== Repo Context (scoped, tool-like) ===");
  blocks.push(`keywords: ${keywords.join(", ")}`);
  blocks.push(`phase: ${params.phase}  round: ${params.round}`);
  blocks.push("");

  let used = 0;
  for (const m of matches) {
    // format: path:line:col?:text
    const first = m.indexOf(":");
    const second = first === -1 ? -1 : m.indexOf(":", first + 1);
    if (first === -1 || second === -1) continue;
    const rel = m.slice(0, first);
    const lineStr = m.slice(first + 1, second);
    const line = Number.parseInt(lineStr, 10);
    if (!Number.isFinite(line) || line <= 0) continue;

    const absPath = path.join(root, rel);
    const snippet = await excerptForMatch({ absPath, line, radius: params.excerptRadiusLines });
    if (!snippet) continue;

    const header = `---\n${rel}:${line}\n---`;
    const block = [header, snippet].join("\n");
    const nextSize = Buffer.byteLength(block + "\n\n", "utf8");
    if (used + nextSize > params.budgetBytes) break;
    used += nextSize;

    refs.push({ file: rel, line });
    blocks.push(block);
    blocks.push("");
  }

  const { text, truncated } = clampTextByBytes(blocks.join("\n").trim() + "\n", params.budgetBytes);
  log(`[council] repo context: ${keywords.length} keywords, ${refs.length} refs, ${Buffer.byteLength(text, "utf8")} bytes`);
  return { text, refs, truncated };
}

