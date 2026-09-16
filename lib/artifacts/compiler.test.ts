import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentState, AgentStep } from "../agent/state.ts";
import { compileArtifact } from "./compiler.ts";

function step(
  partial: Omit<AgentStep, "timestamp"> & { timestamp?: number },
): AgentStep {
  return { timestamp: 1, ...partial };
}

function memberLookupState(): AgentState {
  return {
    runId: "run-member-1",
    goal: "Look up member 002010",
    startUrl: "https://example.com/",
    authRequired: false,
    recordArtifact: true,
    status: "success",
    stepCount: 4,
    history: [
      step({
        step: 1,
        toolCall: { name: "click", arguments: { ref: "e0" } },
        toolResult: { ok: true },
        recordedTarget: {
          ref: "e0",
          text: "Member",
          href: "https://example.com/members",
        },
      }),
      step({
        step: 2,
        toolCall: {
          name: "type",
          arguments: { ref: "e1", text: "002010" },
        },
        toolResult: { ok: true },
        recordedTarget: {
          ref: "e1",
          testId: "search-input",
          name: "q",
        },
      }),
      step({
        step: 3,
        toolCall: { name: "click", arguments: { ref: "e2" } },
        toolResult: { ok: true },
        recordedTarget: {
          ref: "e2",
          testId: "search-submit",
          name: "search",
        },
      }),
      step({
        step: 4,
        toolCall: { name: "click", arguments: { ref: "e3" } },
        toolResult: { ok: true },
        recordedTarget: {
          ref: "e3",
          text: "View Member",
          href: "https://example.com/members/002010",
        },
      }),
    ],
    observation: {
      url: "https://example.com/members/002010?flash=Member%20lookup%20completed",
      title: "Member",
      snapshot: `
- alert: Member lookup completed
- term: Member ID
- definition: redacted
`,
      elements: [],
    },
  } as unknown as AgentState;
}

test("serialized artifact drops dynamic member URL and id", () => {
  const artifact = compileArtifact(memberLookupState(), {
    inputNameByText: { "002010": "member_query" },
  });

  const json = JSON.stringify(artifact);
  assert.equal(json.includes("002010"), false);
  assert.equal(json.includes("/members/002010"), false);

  const view = artifact.steps.find(
    (s) => s.action === "click" && "target" in s && s.target.text === "View Member",
  );
  assert.ok(view && view.action === "click");
  assert.equal(view.target.within?.kind, "matching_container");
  assert.deepEqual(view.target.within?.value, {
    source: "input",
    name: "member_query",
  });
  assert.equal("recorded" in view.target, false);
  assert.equal(artifact.checkpoint.kind, "text_present");
  assert.equal(artifact.checkpoint.text, "Member lookup completed");
});

test("deriveCheckpoint from flash strips account amounts", async () => {
  const { deriveCheckpoint, stabilizeAckText } = await import("./compiler.ts");
  assert.equal(
    stabilizeAckText(
      "Cheque book ordered. Debited $15.00 from CK-2010. TX-CK-2010-0261",
    ),
    "Cheque book ordered",
  );
  const cp = deriveCheckpoint(
    "",
    "https://dough-credit-union.vercel.app/members/x?flash=Cheque%20book%20ordered.%20Debited%20%2415.00%20from%20CK-2010.%20TX-CK-2010-0261",
  );
  assert.equal(cp.text, "Cheque book ordered");
});

test("pendingCommit HITL click is compiled as final step", () => {
  const state = memberLookupState();
  state.pendingCommit = {
    toolCall: {
      name: "click",
      arguments: { ref: "order" },
    },
    recordedTarget: {
      ref: "order",
      role: "button",
      name: "Order cheque book",
      text: "Order cheque book",
    },
  };
  state.observation = {
    url: "https://example.com/m?flash=Cheque%20book%20ordered.%20Debited%20%2415.00%20from%20CK-2010",
    title: "Done",
    snapshot: `- alert: "Cheque book ordered"`,
    elements: [],
  };

  const artifact = compileArtifact(state, {
    inputNameByText: { "002010": "member_query" },
  });

  const last = artifact.steps[artifact.steps.length - 1];
  assert.ok(last && last.action === "click");
  assert.equal(
    last.action === "click" && (last.target.name === "Order cheque book" || last.target.text === "Order cheque book"),
    true,
  );
  assert.equal(artifact.checkpoint.text, "Cheque book ordered");
});

test("look-up detail page uses Member ID as checkpoint", () => {
  const state = memberLookupState();
  state.observation = {
    url: "https://example.com/members/1",
    title: "Member",
    snapshot: `
- term: Member ID
- definition: 002010
- term: Email
- definition: a@b.com
`,
    elements: [],
  };
  const artifact = compileArtifact(state, {
    inputNameByText: { "002010": "member_query" },
  });
  assert.equal(artifact.checkpoint.text, "Member ID");
});

test("compile fails without terminal acknowledgement", () => {
  const state = memberLookupState();
  state.observation = {
    url: "https://example.com/members/1",
    title: "Member",
    snapshot: `- heading "Home"\n- link "Member"`,
    elements: [],
  };
  assert.throws(
    () => compileArtifact(state, { inputNameByText: { "002010": "member_query" } }),
    /checkpoint/i,
  );
});
