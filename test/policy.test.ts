import test from "node:test";
import assert from "node:assert/strict";
import { actionRequiresApproval, validateAction } from "../src/agent/policy.ts";
import { proposeAction } from "../src/agent/tools.ts";

test("external and reversible actions require approval", () => {
  for (const risk of ["reversible", "external", "high"] as const) {
    assert.equal(actionRequiresApproval(proposeAction({ tool: "test", title: "Test", summary: "Test", risk, args: {} })), true);
  }
  assert.equal(actionRequiresApproval(proposeAction({ tool: "test", title: "Test", summary: "Test", risk: "prepare", args: {} })), false);
});

test("calendar events need a title and valid start", () => {
  const action = proposeAction({
    tool: "calendar.create_event",
    title: "Create event",
    summary: "Bad event",
    risk: "reversible",
    args: { title: "", start: "whenever" },
  });
  assert.equal(validateAction(action).length, 2);
});

test("sending email requires a complete recipient and body", () => {
  const action = proposeAction({
    tool: "email.send", title: "Send", summary: "Send email", risk: "external",
    args: { to: "Sam", body: "" },
  });
  assert.equal(validateAction(action).length, 2);
});
