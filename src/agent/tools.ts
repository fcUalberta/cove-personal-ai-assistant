import { randomUUID } from "node:crypto";
import type { ProposedAction, RiskLevel } from "../types.ts";

export function proposeAction(input: {
  tool: string;
  title: string;
  summary: string;
  risk: RiskLevel;
  args: Record<string, unknown>;
}): ProposedAction {
  return {
    id: randomUUID(),
    ...input,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

