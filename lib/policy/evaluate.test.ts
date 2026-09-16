import assert from "node:assert/strict";
import { test } from "node:test";
import { getPolicyConfig, type PolicyConfig } from "./config.ts";
import { classifyRisk, evaluateActionPolicy } from "./evaluate.ts";

const DOUGH = "https://dough-credit-union.vercel.app";

function cfg(partial: Partial<PolicyConfig> = {}): PolicyConfig {
  return {
    ...getPolicyConfig(),
    allowedOrigins: [DOUGH],
    ...partial,
  };
}

test("allowlisted origin + action executes", () => {
  const d = evaluateActionPolicy(
    { action: "navigate", navigateUrl: `${DOUGH}/members` },
    cfg(),
  );
  assert.equal(d.ok, true);
  if (d.ok) assert.equal(d.risk, "safe");
});

test("disallowed origin blocked including startUrl not on list", () => {
  const d = evaluateActionPolicy(
    { action: "navigate", navigateUrl: "https://evil.example/app" },
    cfg(),
  );
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "origin_blocked");
});

test("disallowed action blocked", () => {
  const d = evaluateActionPolicy(
    { action: "hover", currentUrl: `${DOUGH}/` },
    cfg({ allowedActions: ["navigate", "click", "type", "select", "press_key"] }),
  );
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "action_blocked");
});

test("element.risk risky requires human", () => {
  const d = evaluateActionPolicy(
    {
      action: "click",
      currentUrl: `${DOUGH}/transfer`,
      element: { risk: "risky", name: "Confirm" },
    },
    cfg(),
  );
  assert.equal(d.ok, false);
  if (!d.ok) {
    assert.equal(d.code, "policy_requires_human");
    assert.equal(d.risk, "risky");
  }
});

test("safe/reversible without attribute executes", () => {
  const click = evaluateActionPolicy(
    {
      action: "click",
      currentUrl: `${DOUGH}/`,
      element: { name: "Member" },
    },
    cfg(),
  );
  assert.equal(click.ok, true);
  if (click.ok) assert.equal(click.risk, "reversible_mutation");

  const nav = evaluateActionPolicy(
    { action: "navigate", navigateUrl: `${DOUGH}/` },
    cfg(),
  );
  assert.equal(nav.ok, true);
  if (nav.ok) assert.equal(nav.risk, "safe");
});

test("keyword fallback only when data-risk absent", () => {
  assert.equal(
    classifyRisk("click", { name: "Confirm transfer", risk: null }),
    "risky",
  );
  assert.equal(
    classifyRisk("click", {
      name: "Confirm transfer",
      risk: "reversible_mutation",
    }),
    "reversible_mutation",
  );
});

test("getPolicyConfig has no baseOrigin parameter", () => {
  const c = getPolicyConfig();
  assert.ok(c.allowedOrigins.includes(DOUGH));
  assert.equal(getPolicyConfig.length, 0);
});
