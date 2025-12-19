export type BeadsComment = {
  id: number;
  text: string;
  author?: string;
  issue_id?: string;
  created_at?: string;
};

export function parseBeadsComments(value: unknown): BeadsComment[] {
  if (!Array.isArray(value)) return [];
  const out: BeadsComment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = o.id;
    const text = o.text;
    if (typeof id !== "number" || !Number.isFinite(id)) continue;
    if (typeof text !== "string") continue;
    out.push({
      id,
      text,
      author: typeof o.author === "string" ? o.author : undefined,
      issue_id: typeof o.issue_id === "string" ? o.issue_id : undefined,
      created_at: typeof o.created_at === "string" ? o.created_at : undefined,
    });
  }
  return out;
}

export function maxBeadsCommentId(comments: BeadsComment[]): number {
  let max = 0;
  for (const c of comments) max = Math.max(max, c.id);
  return max;
}

export function extractUserMessage(text: string): string | null {
  const normalized = text.replaceAll("\r\n", "\n").trim();
  if (!normalized) return null;
  const lines = normalized.split("\n");
  if (!lines[0]?.includes("**USER**")) return null;
  return lines.slice(1).join("\n").trim();
}

export function findUserReplySince(params: {
  comments: BeadsComment[];
  afterId: number;
}): { id: number; message: string } | null {
  for (const c of params.comments) {
    if (c.id <= params.afterId) continue;
    const msg = extractUserMessage(c.text);
    if (!msg) continue;
    return { id: c.id, message: msg };
  }
  return null;
}

