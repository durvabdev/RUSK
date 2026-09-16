import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserController } from "../../browser/browser.ts";
import type { AgentState } from "../state.ts";
import { createObserveNode } from "./observe.ts";

function mockBrowser(): BrowserController {
  return {
    async observe() {
      return {
        url: "https://example.com",
        title: "Example",
        snapshot: '- heading "Example"',
        elements: [],
      };
    },
    async navigate() {
      return { ok: true };
    },
    async click() {
      return { ok: true };
    },
    async type() {
      return { ok: true };
    },
    async select() {
      return { ok: true };
    },
    async pressKey() {
      return { ok: true };
    },
    async hover() {
      return { ok: true };
    },
    async goBack() {
      return { ok: true };
    },
    async scroll() {
      return { ok: true };
    },
  };
}

test("observeNode returns only observation", async () => {
  const observeNode = createObserveNode(mockBrowser());
  const state = {
    runId: "run-1",
    goal: "Find the balance",
    history: [],
    stepCount: 3,
    status: "running",
  } as unknown as AgentState;

  const update = await observeNode(state);

  assert.deepEqual(update, {
    observation: {
      url: "https://example.com",
      title: "Example",
      snapshot: '- heading "Example"',
      elements: [],
    },
  });
  assert.equal("history" in update, false);
  assert.equal("stepCount" in update, false);
  assert.equal("status" in update, false);
});
