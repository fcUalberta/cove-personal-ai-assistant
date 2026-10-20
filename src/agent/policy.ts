import type { ProposedAction, RiskLevel } from "../types.ts";

const REQUIRES_APPROVAL = new Set<RiskLevel>(["reversible", "external", "high"]);

export function actionRequiresApproval(action: ProposedAction): boolean {
  return REQUIRES_APPROVAL.has(action.risk);
}

export function validateAction(action: ProposedAction): string[] {
  const errors: string[] = [];
  if (!action.tool.trim()) errors.push("Tool name is required.");
  if (!action.title.trim()) errors.push("Action title is required.");

  if (action.tool === "calendar.create_event") {
    if (typeof action.args.title !== "string" || !action.args.title.trim()) {
      errors.push("Calendar title is required.");
    }
    if (typeof action.args.start !== "string" || Number.isNaN(Date.parse(action.args.start))) {
      errors.push("A valid calendar start time is required.");
    }
  }

  if (["email.create_draft", "email.send"].includes(action.tool)) {
    if (typeof action.args.body !== "string" || !action.args.body.trim()) {
      errors.push("Email body is required.");
    }
  }

  if (action.tool === "email.send") {
    if (typeof action.args.to !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(action.args.to.trim())) {
      errors.push("A complete recipient email address is required before sending.");
    }
  }

  if (action.tool === "email.send_draft" && (typeof action.args.draftId !== "string" || !action.args.draftId)) {
    errors.push("A Gmail draft ID is required before sending.");
  }

  return errors;
}
