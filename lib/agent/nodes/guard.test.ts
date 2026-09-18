import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserController, ElementInspection } from "../../browser/browser.ts";
import type { DomCandidate } from "../../browser/dom-inspect.ts";
import { CREDENTIAL_HUMAN_REQUEST } from "../auth-form.ts";
import type { AgentState } from "../state.ts";
import { createGuardNode } from "./guard.ts";

function inspection(
  partial: Partial<ElementInspection>,
): ElementInspection {
  return {
    tag: "input",
    role: null,
    text: null,
    ariaLabel: null,
    name: null,
    type: "text",
    href: null,
    placeholder: null,
    autocomplete: null,
    testId: null,
    risk: null,
    actionCategory: null,
    contentEditable: false,
    disabled: false,
    readOnly: false,
    value: null,
    checked: null,
    rect: { x: 0, y: 0, width: 10, height: 10 },
    ...partial,
  };
}

function candidate(partial: Partial<DomCandidate>): DomCandidate {
  return {
    tag: "input",
    role: null,
    text: null,
    ariaLabel: null,
    name: null,
    inputType: "text",
    href: null,
    placeholder: null,
    contentEditable: false,
    disabled: false,
    readOnly: false,
    value: null,
    visible: true,
    rect: { x: 0, y: 0, width: 10, height: 10 },
    selector: null,
    ...partial,
  };
}

function baseState(
  call: { name: string; arguments: Record<string, unknown> },
  url = "https://dough-credit-union.vercel.app/login",
): AgentState {
  return {
    runId: "run-1",
    goal: "Look up member 002010",
    observation: {
      url,
      title: "Login",
      snapshot: "form",
    },
    history: [],
    stepCount: 1,
    status: "running",
    decision: {
      type: "tool",
      call,
      reason: null,
      request: null,
    },
  } as unknown as AgentState;
}

test("typing into detected username field is blocked", async () => {
  const browser = {
    async inspectDom() {
      return {
        url: "https://example.com/login",
        title: "Login",
        candidates: [
          candidate({ name: "username", inputType: "text" }),
          candidate({ name: "password", inputType: "password" }),
        ],
      };
    },
    async inspectElement() {
      return inspection({ name: "username", type: "text" });
    },
  } as unknown as BrowserController;

  const update = await createGuardNode(browser)(
    baseState(
      { name: "type", arguments: { ref: "e1", text: "002010" } },
      "https://example.com/login",
    ),
  );

  assert.equal(update.decision?.type, "human");
  assert.deepEqual(update.decision?.request, CREDENTIAL_HUMAN_REQUEST);
  assert.deepEqual(update.humanRequest, CREDENTIAL_HUMAN_REQUEST);
  assert.equal(update.status, "waiting_for_human");
  assert.equal("history" in update, false);
});

test("typing into detected password field is blocked", async () => {
  const browser = {
    async inspectDom() {
      return {
        url: "https://example.com/login",
        title: "Login",
        candidates: [
          candidate({ placeholder: "Email", inputType: "email" }),
          candidate({ inputType: "password", ariaLabel: "Password" }),
        ],
      };
    },
    async inspectElement() {
      return inspection({ type: "password", name: "password" });
    },
  } as unknown as BrowserController;

  const update = await createGuardNode(browser)(
    baseState(
      {
        name: "type",
        arguments: { ref: "e2", text: "invented-secret" },
      },
      "https://example.com/login",
    ),
  );

  assert.equal(update.decision?.type, "human");
  assert.equal(update.humanRequest?.type, "credential");
  assert.equal("history" in update, false);
  assert.equal(
    JSON.stringify(update).includes("invented-secret"),
    false,
  );
});

test("task value like 002010 is still blocked on username field", async () => {
  const browser = {
    async inspectDom() {
      return {
        url: "https://example.com/login",
        title: "Login",
        candidates: [
          candidate({ name: "user id", inputType: "text" }),
          candidate({ name: "password", inputType: "password" }),
        ],
      };
    },
    async inspectElement() {
      return inspection({ name: "user id", type: "text" });
    },
  } as unknown as BrowserController;

  const update = await createGuardNode(browser)(
    baseState(
      { name: "type", arguments: { ref: "e3", text: "002010" } },
      "https://example.com/login",
    ),
  );

  assert.equal(update.decision?.type, "human");
});

test("normal non-auth text field still executes (guard no-op)", async () => {
  const browser = {
    async inspectDom() {
      return {
        url: "https://dough-credit-union.vercel.app/search",
        title: "Search",
        candidates: [
          candidate({ placeholder: "Search member", inputType: "text" }),
        ],
      };
    },
    async inspectElement() {
      return inspection({
        name: "q",
        type: "text",
        placeholder: "Search member",
      });
    },
  } as unknown as BrowserController;

  const update = await createGuardNode(browser)(
    baseState(
      {
        name: "type",
        arguments: { ref: "e9", text: "002010" },
      },
      "https://dough-credit-union.vercel.app/search",
    ),
  );

  assert.deepEqual(update, {});
});

test("non-type tools pass through the guard", async () => {
  const browser = {
    async inspectDom() {
      throw new Error("should not inspect");
    },
    async inspectElement() {
      return inspection({ role: "button", name: "Go", risk: null });
    },
  } as unknown as BrowserController;

  const update = await createGuardNode(browser)(
    baseState(
      { name: "click", arguments: { ref: "e1" } },
      "https://dough-credit-union.vercel.app/",
    ),
  );

  assert.deepEqual(update, {});
});

test("auth form + inspectElement failure still blocks credential typing", async () => {
  const browser = {
    async inspectDom() {
      return {
        url: "https://example.com/login",
        title: "Login",
        candidates: [
          candidate({ name: "username", inputType: "text" }),
          candidate({ name: "password", inputType: "password" }),
        ],
      };
    },
    async inspectElement() {
      throw new Error("inspect_element returned invalid JSON");
    },
  } as unknown as BrowserController;

  const update = await createGuardNode(browser)(
    baseState(
      { name: "type", arguments: { ref: "e1", text: "002010" } },
      "https://example.com/login",
    ),
  );

  assert.equal(update.decision?.type, "human");
  assert.equal(update.humanRequest?.type, "credential");
  assert.equal("history" in update, false);
});

test("disallowed origin hard-denies", async () => {
  const browser = {
    async inspectDom() {
      throw new Error("should not inspect");
    },
    async inspectElement() {
      return inspection({ role: "button", name: "Go" });
    },
  } as unknown as BrowserController;

  const update = await createGuardNode(browser)(
    baseState(
      { name: "click", arguments: { ref: "e1" } },
      "https://evil.example/",
    ),
  );

  assert.equal(update.status, "failed");
  assert.match(String(update.error), /origin_blocked/);
  assert.equal(update.decision?.type, "finish");
});
