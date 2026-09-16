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
      url: "https://example.com/members/002010",
      title: "Member",
      snapshot: "",
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
});
