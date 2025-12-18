import { z } from "zod";

export const ArtifactSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  content: z.string(),
  mime: z.string().optional(),
  suggested_filename: z.string().optional(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

export const AgentResponseSchema = z.object({
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

export type AgentResponse = z.infer<typeof AgentResponseSchema>;

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
      "summary",
      "recommendations",
      "risks",
      "open_questions",
      "need_another_round",
      "chair_score",
      "chair_reason",
      "artifacts",
    ],
    properties: {
      agent: { type: "string", minLength: 1 },
      round: { type: "integer", minimum: 1 },
      phase: { type: "string", enum: ["research", "critique", "synthesis", "oracle"] },
      summary: { type: "string" },
      recommendations: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      open_questions: { type: "array", items: { type: "string" } },
      need_another_round: { type: "boolean" },
      why_continue: { type: "string" },
      chair_score: { type: "number", minimum: 0, maximum: 10 },
      chair_reason: { type: "string" },
      artifacts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "title", "content"],
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

