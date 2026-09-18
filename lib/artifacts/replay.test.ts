import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserController, ElementInspection } from "../browser/browser.ts";
import { replayArtifact } from "./replay.ts";
import type { WorkflowArtifact } from "./schema.ts";

process.env.RUSK_RUNS_DIR =
  process.env.RUSK_RUNS_DIR ??
  `${process.cwd()}/.rusk/test-runs-${process.pid}`;

/** Artifact shape as compiled from a Priya run (no recorded member id/url). */
function lookUpMemberArtifact(): WorkflowArtifact {
  return {
    id: "look-up-member-fixture",
    version: 1,
    kind: "browser_workflow",
    name: "look_up_member",
    description: "Look up member",
    sourceRunId: "run-priya",
    startUrl: "https://dough-credit-union.vercel.app/",
    requiresAuthenticatedSession: false,
    inputs: {
      member_query: {
        type: "string",
        required: true,
        description: "q",
      },
    },
    steps: [
      { action: "click", target: { text: "Member" } },
      {
        action: "type",
        target: { testId: "search-input", name: "q" },
        value: { source: "input", name: "member_query" },
      },
      {
        action: "click",
        target: { testId: "search-submit", name: "search" },
      },
      {
        action: "click",
        target: {
          text: "View Member",
          within: {
            kind: "matching_container",
            value: { source: "input", name: "member_query" },
          },
        },
      },
    ],
    outputs: [
      {
        name: "member_id",
        type: "string",
        extractor: { kind: "definition", label: "Member ID" },
      },
      {
        name: "email",
        type: "string",
        extractor: { kind: "definition", label: "Email" },
      },
      {
        name: "phone",
        type: "string",
        extractor: { kind: "definition", label: "Phone" },
      },
      {
        name: "address",
        type: "string",
        extractor: { kind: "definition", label: "Address" },
      },
    ],
    conditions: [],
    checkpoint: { kind: "text_present", text: "Member ID" },
    createdAt: "2026-09-16T00:00:00.000Z",
  };
}

/** Home page has heading + link both named Member (live-site ambiguity). */
const HOME_SNAPSHOT = `
- heading "Member" [ref=home-heading]
- link "Member" [ref=nav-member]
`;

const SEARCH_SNAPSHOT = `
- textbox "q" [ref=search]
- button "search" [ref=submit]
`;

function inspection(partial: Partial<ElementInspection>): ElementInspection {
  return {
    tag: "div",
    role: null,
    text: null,
    ariaLabel: null,
    name: null,
    type: null,
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
    rect: { x: 0, y: 0, width: 0, height: 0 },
    ...partial,
  };
}

const FAST_POLL = { pollIntervalMs: 20, pollTimeoutMs: 80 };

function baseBrowser(
  overrides: Partial<BrowserController> = {},
): BrowserController {
  return {
    observe: async () => ({ snapshot: "", elements: [] }),
    navigate: async () => ({ ok: true }),
    click: async () => ({ ok: true }),
    type: async () => ({ ok: true }),
    select: async () => ({ ok: true }),
    pressKey: async () => ({ ok: true }),
    hover: async () => ({ ok: true }),
    goBack: async () => ({ ok: true }),
    scroll: async () => ({ ok: true }),
    inspectElement: async () => inspection({ rect: { x: 0, y: 0, width: 10, height: 10 } }),
    inspectDom: async () => ({ url: "", title: "", candidates: [] }),
    captureFormFields: async () => [],
    ...overrides,
  };
}

test("known member_not_found condition returns business_outcome", async () => {
  const artifact: WorkflowArtifact = {
    ...lookUpMemberArtifact(),
    steps: [
      { action: "click", target: { text: "Member" } },
      {
        action: "type",
        target: { testId: "search-input" },
        value: { source: "input", name: "member_query" },
      },
      {
        action: "click",
        target: { testId: "search-submit" },
      },
      {
        action: "click",
        target: { text: "View Member" },
      },
    ],
    conditions: [
      {
        class: "business_outcome",
        code: "member_not_found",
        message: "No members found",
        when: { kind: "text_present", text: "No members found" },
      },
    ],
    outputs: [],
  };

  let phase: "home" | "search" | "empty" = "home";
  const browser = baseBrowser({
    observe: async () => {
      if (phase === "home") {
        return { snapshot: HOME_SNAPSHOT, elements: [], url: "https://dough-credit-union.vercel.app/" };
      }
      if (phase === "search") {
        return { snapshot: SEARCH_SNAPSHOT, elements: [], url: "https://dough-credit-union.vercel.app/search" };
      }
      return {
        snapshot: `- text: "No members found"`,
        elements: [],
        url: "https://dough-credit-union.vercel.app/search",
      };
    },
    click: async (ref) => {
      if (ref === "nav-member") phase = "search";
      else if (ref === "submit") phase = "empty";
      return { ok: true };
    },
    inspectElement: async (ref) => {
      if (ref === "nav-member") {
        return inspection({
          role: "link",
          text: "Member",
          name: "Member",
          rect: { x: 0, y: 0, width: 40, height: 20 },
        });
      }
      if (ref === "search") {
        return inspection({ testId: "search-input", tag: "input" });
      }
      if (ref === "submit") {
        return inspection({ testId: "search-submit", tag: "button" });
      }
      return inspection({
        role: "heading",
        rect: { x: 0, y: 0, width: 100, height: 20 },
      });
    },
  });

  const result = await replayArtifact(
    artifact,
    { member_query: "nobody" },
    browser,
    FAST_POLL,
  );

  assert.equal(result.status, "business_outcome");
  if (result.status !== "business_outcome") return;
  assert.equal(result.code, "member_not_found");
  assert.equal(result.message, "No members found");
});

test("delayed target appears after polls then succeeds", async () => {
  let observes = 0;
  const browser = baseBrowser({
    observe: async () => {
      observes += 1;
      // First resolve attempt misses; later attempts see the link.
      if (observes < 3) {
        return { snapshot: `- heading "Home" [ref=h]`, elements: [] };
      }
      return {
        snapshot: `- link "Go" [ref=go]`,
        elements: [],
        url: "https://dough-credit-union.vercel.app/",
      };
    },
    inspectElement: async (ref) =>
      inspection({
        role: ref === "go" ? "link" : "heading",
        text: ref === "go" ? "Go" : "Home",
        name: ref === "go" ? "Go" : "Home",
        rect: { x: 0, y: 0, width: 20, height: 10 },
      }),
  });

  const artifact: WorkflowArtifact = {
    id: "delay-target",
    version: 1,
    kind: "browser_workflow",
    name: "delay_target",
    description: "d",
    sourceRunId: "r",
    startUrl: "https://dough-credit-union.vercel.app/",
    requiresAuthenticatedSession: false,
    inputs: {},
    steps: [{ action: "click", target: { text: "Go" } }],
    outputs: [],
    conditions: [],
    checkpoint: { kind: "text_present", text: "Go" },
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const result = await replayArtifact(artifact, {}, browser, {
    pollIntervalMs: 10,
    pollTimeoutMs: 500,
  });
  assert.equal(result.status, "success");
  assert.ok(observes >= 3);
});

test("checkpoint timeout returns checkpoint_failed", async () => {
  const browser = baseBrowser({
    observe: async () => ({
      snapshot: `- link "Next" [ref=next]
- heading "Loading" [ref=h]`,
      elements: [],
      url: "https://dough-credit-union.vercel.app/",
    }),
    inspectElement: async (ref) =>
      inspection({
        role: ref === "next" ? "link" : "heading",
        text: ref === "next" ? "Next" : "Loading",
        name: ref === "next" ? "Next" : "Loading",
        rect: { x: 0, y: 0, width: 20, height: 10 },
      }),
  });

  const artifact: WorkflowArtifact = {
    id: "checkpoint-fail",
    version: 1,
    kind: "browser_workflow",
    name: "checkpoint_fail",
    description: "d",
    sourceRunId: "r",
    startUrl: "https://dough-credit-union.vercel.app/",
    requiresAuthenticatedSession: false,
    inputs: {},
    steps: [
      {
        action: "click",
        target: { text: "Next" },
        checkpoint: { kind: "text_present", text: "Ready" },
      },
    ],
    outputs: [],
    conditions: [],
    checkpoint: { kind: "text_present", text: "Ready" },
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const result = await replayArtifact(artifact, {}, browser, FAST_POLL);
  assert.equal(result.status, "failure");
  if (result.status !== "failure") return;
  assert.equal(result.code, "checkpoint_failed");
});

test("replay blocks disallowed startUrl before navigate", async () => {
  let navigated = false;
  const browser = baseBrowser({
    navigate: async () => {
      navigated = true;
      return { ok: true };
    },
  });

  const artifact: WorkflowArtifact = {
    id: "bad-origin",
    version: 1,
    kind: "browser_workflow",
    name: "bad_origin",
    description: "d",
    sourceRunId: "r",
    startUrl: "https://evil.example/",
    requiresAuthenticatedSession: false,
    inputs: {},
    steps: [],
    outputs: [],
    conditions: [],
    checkpoint: { kind: "text_present", text: "ok" },
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const result = await replayArtifact(artifact, {}, browser, FAST_POLL);
  assert.equal(result.status, "failure");
  if (result.status !== "failure") return;
  assert.equal(result.code, "origin_blocked");
  assert.equal(navigated, false);
});

test("artifact checkpoint missing yields checkpoint_failed despite member outputs", async () => {
  const detail = `
- button "Order cheque book" [ref=order]
- term: Member ID
- definition: 002010
- term: Email
- definition: p@example.com
- term: Phone
- definition: 555
- term: Address
- definition: Street
`;
  const browser = baseBrowser({
    observe: async () => ({
      snapshot: detail,
      elements: [],
      url: "https://dough-credit-union.vercel.app/members/002010",
    }),
    click: async () => ({ ok: true }),
    inspectElement: async () =>
      inspection({
        role: "button",
        name: "Order cheque book",
        text: "Order cheque book",
        rect: { x: 0, y: 0, width: 20, height: 10 },
      }),
  });

  const artifact: WorkflowArtifact = {
    id: "cheque-no-ack",
    version: 1,
    kind: "browser_workflow",
    name: "cheque_no_ack",
    description: "d",
    sourceRunId: "r",
    startUrl: "https://dough-credit-union.vercel.app/",
    requiresAuthenticatedSession: false,
    inputs: {},
    steps: [{ action: "click", target: { text: "Order cheque book" } }],
    outputs: [
      {
        name: "member_id",
        type: "string",
        extractor: { kind: "definition", label: "Member ID" },
      },
    ],
    conditions: [],
    checkpoint: { kind: "text_present", text: "Cheque book ordered" },
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const result = await replayArtifact(artifact, {}, browser, FAST_POLL);
  assert.equal(result.status, "failure");
  if (result.status !== "failure") return;
  assert.equal(result.code, "checkpoint_failed");
});

test("delayed artifact checkpoint eventually succeeds", async () => {
  let observes = 0;
  const browser = baseBrowser({
    observe: async () => {
      observes += 1;
      if (observes < 4) {
        return {
          snapshot: `
- button "Order cheque book" [ref=order]
- term: Member ID
- definition: 002010
`,
          elements: [],
          url: "https://dough-credit-union.vercel.app/cheques",
        };
      }
      return {
        snapshot: `
- alert: "Cheque book ordered"
- term: Member ID
- definition: 002010
`,
        elements: [],
        url: "https://dough-credit-union.vercel.app/members/002010?flash=Cheque%20book%20ordered",
      };
    },
    click: async () => ({ ok: true }),
    inspectElement: async () =>
      inspection({
        role: "button",
        name: "Order cheque book",
        text: "Order cheque book",
        rect: { x: 0, y: 0, width: 20, height: 10 },
      }),
  });

  const artifact: WorkflowArtifact = {
    id: "cheque-ack-delay",
    version: 1,
    kind: "browser_workflow",
    name: "cheque_ack_delay",
    description: "d",
    sourceRunId: "r",
    startUrl: "https://dough-credit-union.vercel.app/",
    requiresAuthenticatedSession: false,
    inputs: {},
    steps: [{ action: "click", target: { text: "Order cheque book" } }],
    outputs: [
      {
        name: "member_id",
        type: "string",
        extractor: { kind: "definition", label: "Member ID" },
      },
    ],
    conditions: [],
    checkpoint: { kind: "text_present", text: "Cheque book ordered" },
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const result = await replayArtifact(artifact, {}, browser, {
    pollIntervalMs: 10,
    pollTimeoutMs: 500,
  });
  assert.equal(result.status, "success");
  if (result.status !== "success") return;
  assert.equal(result.outputs.member_id, "002010");
});

test("condition during final checkpoint wait wins", async () => {
  const browser = baseBrowser({
    observe: async () => ({
      snapshot: `- text: "No members found"`,
      elements: [],
      url: "https://dough-credit-union.vercel.app/search",
    }),
    click: async () => ({ ok: true }),
    inspectElement: async () =>
      inspection({
        role: "button",
        name: "Search",
        rect: { x: 0, y: 0, width: 10, height: 10 },
      }),
  });

  const artifact: WorkflowArtifact = {
    id: "cond-during-cp",
    version: 1,
    kind: "browser_workflow",
    name: "cond_during_cp",
    description: "d",
    sourceRunId: "r",
    startUrl: "https://dough-credit-union.vercel.app/",
    requiresAuthenticatedSession: false,
    inputs: {},
    steps: [{ action: "click", target: { text: "Search" } }],
    outputs: [],
    conditions: [
      {
        class: "business_outcome",
        code: "member_not_found",
        message: "No members found",
        when: { kind: "text_present", text: "No members found" },
      },
    ],
    checkpoint: { kind: "text_present", text: "Cheque book ordered" },
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const result = await replayArtifact(artifact, {}, browser, FAST_POLL);
  assert.equal(result.status, "business_outcome");
  if (result.status !== "business_outcome") return;
  assert.equal(result.code, "member_not_found");
});
