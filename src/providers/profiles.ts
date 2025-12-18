import type { ProviderName } from "./types.js";

export type ProviderProfile = {
  name: ProviderName;
  strengths: string[];
  best_for: string[];
  ask_others_for: string[];
};

export const PROVIDER_PROFILES: Record<Exclude<ProviderName, "oracle">, ProviderProfile> = {
  codex: {
    name: "codex",
    strengths: [
      "Codebase-aware reasoning and implementation planning",
      "Safe automation mindset (sandbox/approvals), operational rigor",
      "Structured outputs and repeatable workflows",
    ],
    best_for: ["Turning ideas into executable steps", "Tool/CLI orchestration constraints", "Catching integration pitfalls"],
    ask_others_for: ["Web-grounded facts (ask Gemini)", "Writing/critique polish (ask Claude)"],
  },
  claude: {
    name: "claude",
    strengths: ["Careful reasoning and critique", "Clarifying requirements and surfacing assumptions", "Architecture/API review clarity"],
    best_for: ["Spec/PRD shaping", "Identifying edge cases", "Reviewing plans for coherence and risk"],
    ask_others_for: ["Web-grounded facts (ask Gemini)", "Concrete CLI execution constraints (ask Codex)"],
  },
  gemini: {
    name: "gemini",
    strengths: ["Web-grounded research (search grounding)", "Large-context synthesis", "Artifacts like diagrams or structured plans"],
    best_for: ["Research with citations/links", "Summarizing large docs", "Creating diagrams/flowcharts for others to critique"],
    ask_others_for: ["Implementation feasibility and safety checks (ask Codex/Claude)"],
  },
};

export function providerProfilesForPrompt(): string {
  const lines: string[] = [];
  lines.push("Provider profiles (use these to coordinate):");
  for (const key of Object.keys(PROVIDER_PROFILES) as (keyof typeof PROVIDER_PROFILES)[]) {
    const p = PROVIDER_PROFILES[key];
    lines.push(`- ${p.name}:`);
    lines.push(`  - Strengths: ${p.strengths.join("; ")}`);
    lines.push(`  - Best for: ${p.best_for.join("; ")}`);
    lines.push(`  - Ask others for: ${p.ask_others_for.join("; ")}`);
  }
  return lines.join("\n");
}

