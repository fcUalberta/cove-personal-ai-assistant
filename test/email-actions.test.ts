import test from "node:test";
import assert from "node:assert/strict";
import { AgentOrchestrator } from "../src/agent/orchestrator.ts";
import type { MemoryRecord, ModelProvider, ProposedAction } from "../src/types.ts";

const offlineModel: ModelProvider = {
  name: "offline",
  isAvailable: async () => false,
  generate: async () => "unused",
};

function createAgent() {
  let memories: MemoryRecord[] = [];
  let actions: ProposedAction[] = [];
  const agent = new AgentOrchestrator({
    localModel: offlineModel,
    cloudEnabled: false,
    readMemories: async () => memories,
    writeMemories: async (value) => { memories = value; },
    readActions: async () => actions,
    writeActions: async (value) => { actions = value; },
    executeAction: async (action) => action.tool === "email.create_draft"
      ? { mode: "google", id: "draft-123" }
      : { mode: "google", sent: true },
  });
  return { agent, actions: () => actions };
}

test("direct email requests create a send action that waits for approval", async () => {
  const { agent } = createAgent();
  const response = await agent.handle({
    message: "Please send an email to person@example.com saying The report is ready.",
    privacyMode: "local-only",
  });
  assert.equal(response.proposedActions[0]?.tool, "email.send");
  assert.equal(response.proposedActions[0]?.status, "pending");
  assert.equal(response.proposedActions[0]?.args.body, "The report is ready.");
  const repeated = await agent.handle({ message: "Can you send the email?", privacyMode: "local-only" });
  assert.equal(repeated.proposedActions[0]?.id, response.proposedActions[0]?.id);
  assert.match(repeated.text, /waiting for your approval/i);
});

test("multiline task email phrasing creates an approval instead of model prose", async () => {
  const { agent } = createAgent();
  const response = await agent.handle({
    message: "Send an email to frincy@womeninai.co\ntask: send the outline of the report and its draft version within a day",
    privacyMode: "local-only",
  });
  assert.equal(response.source, "workflow");
  assert.equal(response.proposedActions[0]?.tool, "email.send");
  assert.equal(response.proposedActions[0]?.args.to, "frincy@womeninai.co");
  assert.equal(response.proposedActions[0]?.args.body, "send the outline of the report and its draft version within a day");
  const repeated = await agent.handle({ message: "You can send it", privacyMode: "local-only" });
  assert.equal(repeated.proposedActions[0]?.id, response.proposedActions[0]?.id);
});

test("ambiguous send follow-ups never claim an email was sent", async () => {
  const { agent } = createAgent();
  const response = await agent.handle({ message: "You can send it", privacyMode: "local-only" });
  assert.equal(response.source, "workflow");
  assert.equal(response.proposedActions.length, 0);
  assert.match(response.text, /not sent anything/i);
});

test("send it resolves the most recent approved Gmail draft", async () => {
  const { agent } = createAgent();
  const draftResponse = await agent.handle({
    message: "Draft an email to person@example.com: Hello there.",
    privacyMode: "local-only",
  });
  await agent.decideAction(draftResponse.proposedActions[0].id, "approve");
  const sendResponse = await agent.handle({ message: "Send it", privacyMode: "local-only" });
  assert.equal(sendResponse.proposedActions[0]?.tool, "email.send_draft");
  assert.equal(sendResponse.proposedActions[0]?.args.draftId, "draft-123");
  assert.equal(sendResponse.proposedActions[0]?.status, "pending");
});
