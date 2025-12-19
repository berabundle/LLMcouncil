import { z } from "zod";

export const ArtifactSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  content: z.string(),
  mime: z.string().optional().default(""),
  suggested_filename: z.string().optional().default(""),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

const AgentResponseV1Schema = z.object({
  agent: z.string().min(1),
  round: z.number().int().min(1),
  phase: z.enum(["research", "critique", "synthesis", "oracle"]),
  summary: z.string(),
  recommendations: z.array(z.string()),
  risks: z.array(z.string()),
  open_questions: z.array(z.string()),
  need_another_round: z.boolean(),
  why_continue: z.string().optional().default(""),
  chair_score: z.number().min(0).max(10),
  chair_reason: z.string(),
  artifacts: z.array(ArtifactSchema),
});

const AgentResponseV2Schema = z.object({
  agent: z.string().min(1),
  round: z.number().int().min(1),
  phase: z.enum(["research", "critique", "synthesis", "oracle"]),
  message: z.string(),
  questions_for_user: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  need_another_round: z.boolean(),
  why_continue: z.string().optional().default(""),
  chair_score: z.number().min(0).max(10),
  chair_reason: z.string(),
  artifacts: z.array(ArtifactSchema),
});

export type AgentResponse = z.infer<typeof AgentResponseV2Schema>;

function splitBullets(text: string): string[] {
  const lines = text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = lines
    .map((l) => l.replace(/^[*-]\s+/, "").trim())
    .filter(Boolean);
  return bullets.length ? bullets : [text.trim()].filter(Boolean);
}

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    return splitBullets(trimmed);
  }
  if (value == null) return [];
  return [String(value)];
}

function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "yes", "y", "continue", "cont"].includes(v)) return true;
    if (["false", "no", "n", "done", "stop"].includes(v)) return false;
  }
  return fallback;
}

export function coerceAgentResponseInput(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const value = input as Record<string, unknown>;
  const artifactsRaw = Array.isArray(value.artifacts) ? value.artifacts : [];
  const artifacts = artifactsRaw
    .map((a) => {
      const o = (a && typeof a === "object" ? (a as Record<string, unknown>) : {}) as Record<string, unknown>;
      return {
        type: String(o.type ?? "").trim(),
        title: String(o.title ?? "").trim(),
        content: String(o.content ?? ""),
        mime: String(o.mime ?? ""),
        suggested_filename: String(o.suggested_filename ?? ""),
      };
    })
    .filter((a) => a.type && a.title); // Drop artifacts with empty type or title

  return {
    ...value,
    message: typeof value.message === "string" ? value.message : String(value.message ?? ""),
    recommendations: coerceStringArray(value.recommendations),
    risks: coerceStringArray(value.risks),
    open_questions: coerceStringArray(value.open_questions),
    questions_for_user: coerceStringArray(value.questions_for_user),
    assumptions: coerceStringArray(value.assumptions),
    need_another_round: coerceBoolean(value.need_another_round, false),
    why_continue: typeof value.why_continue === "string" ? value.why_continue : String(value.why_continue ?? ""),
    chair_score: coerceNumber(value.chair_score, 0),
    chair_reason: typeof value.chair_reason === "string" ? value.chair_reason : String(value.chair_reason ?? ""),
    artifacts,
  };
}

function v1ToV2(v1: z.infer<typeof AgentResponseV1Schema>): AgentResponse {
  const bullets: string[] = [];
  if (v1.recommendations.length) {
    bullets.push("Recommendations:");
    bullets.push(...v1.recommendations.map((r) => `- ${r}`));
  }
  if (v1.risks.length) {
    if (bullets.length) bullets.push("");
    bullets.push("Risks:");
    bullets.push(...v1.risks.map((r) => `- ${r}`));
  }
  if (v1.open_questions.length) {
    if (bullets.length) bullets.push("");
    bullets.push("Open questions:");
    bullets.push(...v1.open_questions.map((q) => `- ${q}`));
  }

  const message = [v1.summary.trim(), bullets.join("\n").trim()].filter(Boolean).join("\n\n");

  return {
    agent: v1.agent,
    round: v1.round,
    phase: v1.phase,
    message,
    questions_for_user: [],
    assumptions: [],
    need_another_round: v1.need_another_round,
    why_continue: v1.why_continue ?? "",
    chair_score: v1.chair_score,
    chair_reason: v1.chair_reason,
    artifacts: v1.artifacts,
  };
}

export function parseAgentResponse(input: unknown): AgentResponse {
  const coerced = coerceAgentResponseInput(input);
  const v2 = AgentResponseV2Schema.safeParse(coerced);
  if (v2.success) return v2.data;
  const v1 = AgentResponseV1Schema.safeParse(coerced);
  if (v1.success) return v1ToV2(v1.data);
  throw v2.error;
}

export function agentResponseJsonSchemaString(): string {
  // Keep this aligned with `.council/schema/agent_response.schema.json`.
  // Claude CLI expects an inline JSON schema string.
  return JSON.stringify({
    type: "object",
    additionalProperties: false,
    required: [
      "agent",
      "round",
      "phase",
      "message",
      "questions_for_user",
      "assumptions",
      "need_another_round",
      "why_continue",
      "chair_score",
      "chair_reason",
      "artifacts",
    ],
    properties: {
      agent: { type: "string", minLength: 1 },
      round: { type: "integer", minimum: 1 },
      phase: { type: "string", enum: ["research", "critique", "synthesis", "oracle"] },
      message: { type: "string" },
      questions_for_user: { type: "array", items: { type: "string" } },
      assumptions: { type: "array", items: { type: "string" } },
      need_another_round: { type: "boolean" },
      why_continue: { type: "string" },
      chair_score: { type: "number", minimum: 0, maximum: 10 },
      chair_reason: { type: "string" },
      artifacts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "title", "content", "mime", "suggested_filename"],
          properties: {
            type: { type: "string", minLength: 1 },
            title: { type: "string", minLength: 1 },
            content: { type: "string" },
            mime: { type: "string" },
            suggested_filename: { type: "string" },
          },
        },
      },
    },
  });
}
