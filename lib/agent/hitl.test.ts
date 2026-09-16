import assert from "node:assert/strict";
import { test } from "node:test";
import { Command } from "@langchain/langgraph";
import {
  interruptFromInvokeResult,
  parseHumanInterrupt,
  resumeInterruptedRun,
} from "./hitl.ts";
import { evaluateActionPolicy } from "../policy/evaluate.ts";
import { getPolicyConfig } from "../policy/config.ts";

process.env.RUSK_RUNS_DIR =
  process.env.RUSK_RUNS_DIR ??
  `${process.cwd()}/.rusk/test-runs-hitl-${process.pid}`;

test("parseHumanInterrupt reads approval request", () => {
  const v = parseHumanInterrupt({
    type: "human_request",
    runId: "r1",
    request: { type: "approval", message: "Risky action" },
  });
  assert.ok(v);
  assert.equal(v?.request.type, "approval");
});

test("initial discovery URL outside allowlist is origin_blocked", () => {
  const d = evaluateActionPolicy(
    { action: "navigate", navigateUrl: "https://evil.example/" },
    { ...getPolicyConfig(), allowedOrigins: ["https://dough-credit-union.vercel.app"] },
  );
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "origin_blocked");
});

test("resume continues same thread_id and does not navigate", async () => {
  const threadIds: string[] = [];
  let navigated = false;
  const graph = {
    invoke: async (input: unknown, config?: { configurable?: { thread_id: string } }) => {
      assert.ok(input instanceof Command);
      threadIds.push(config?.configurable?.thread_id ?? "");
      return { status: "success", result: "done" };
    },
  };
  const browser = {
    navigate: async () => {
      navigated = true;
      return { ok: true };
    },
  };

  const out = await resumeInterruptedRun(graph, "thread-abc", "resume");
  assert.equal(out.status, "success");
  assert.equal(out.runId, "thread-abc");
  assert.deepEqual(threadIds, ["thread-abc"]);
  assert.equal(navigated, false);
  void browser;
});

test("cancel stops run with cancelled status", async () => {
  const graph = {
    invoke: async () => ({ status: "cancelled" }),
  };
  const out = await resumeInterruptedRun(graph, "thread-cancel", "cancel");
  assert.equal(out.status, "cancelled");
  assert.equal(out.runId, "thread-cancel");
});

test("interruptFromInvokeResult maps __interrupt__", () => {
  const result = {
    __interrupt__: [
      {
        value: {
          type: "human_request",
          runId: "r2",
          request: { type: "credential", message: "Auth required" },
        },
      },
    ],
  };
  const parsed = interruptFromInvokeResult(result);
  assert.equal(parsed?.request.type, "credential");
});
