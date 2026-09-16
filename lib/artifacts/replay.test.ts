import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserController, ElementInspection } from "../browser/browser.ts";
import { replayArtifact } from "./replay.ts";
import type { WorkflowArtifact } from "./schema.ts";

process.env.RUSK_RUNS_DIR =
  process.env.RUSK_RUNS_DIR ??
  `${process.cwd()}/.rusk/test-runs-${process.pid}`;

const PRIYA_MEMBER_ID = "002010";
const PRIYA_VIEW_REF = "priya-view";
const MARCUS_VIEW_REF = "marcus-view";

/** Real Dough demo values for Marcus Chen. */
const MARCUS = {
  member_id: "002001",
  email: "marcus.chen@example.com",
  phone: "(206) 555-0177",
  address: "410 Occidental Ave S, Seattle, WA 98104",
} as const;

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

/** Both members present so scoped within must pick Marcus, not the first row. */
const RESULTS_SNAPSHOT = `
- list [ref=results]
  - listitem [ref=priya-row]
    - text: "Priya Nair"
    - link "View Member" [ref=${PRIYA_VIEW_REF}]
  - listitem [ref=marcus-row]
    - text: "Marcus Chen"
    - link "View Member" [ref=${MARCUS_VIEW_REF}]
`;

const MARCUS_DETAIL_SNAPSHOT = `
- term [ref=t1]: Member ID
- definition [ref=d1]: ${MARCUS.member_id}
- term [ref=t2]: Email
- definition [ref=d2]: ${MARCUS.email}
- term [ref=t3]: Phone
- definition [ref=d3]: ${MARCUS.phone}
- term [ref=t4]: Address
- definition [ref=d4]: ${MARCUS.address}
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
    rect: { x: 0, y: 0, width: 0, height: 0 },
    ...partial,
  };
}

function mockBrowserForMarcusReplay(): {
  browser: BrowserController;
  clickedRefs: string[];
  navigatedUrls: string[];
} {
  let phase: "home" | "search" | "results" | "detail" = "home";
  const clickedRefs: string[] = [];
  const navigatedUrls: string[] = [];

  const browser: BrowserController = {
    observe: async () => {
      const snapshot =
        phase === "home"
          ? HOME_SNAPSHOT
          : phase === "search"
            ? SEARCH_SNAPSHOT
            : phase === "results"
              ? RESULTS_SNAPSHOT
              : MARCUS_DETAIL_SNAPSHOT;
      return { snapshot, elements: [] };
    },
    navigate: async (url) => {
      navigatedUrls.push(url);
      phase = "home";
      return { ok: true };
    },
    click: async (ref) => {
      clickedRefs.push(ref);
      if (ref === "nav-member") phase = "search";
      else if (ref === "submit") phase = "results";
      else if (ref === MARCUS_VIEW_REF || ref === PRIYA_VIEW_REF) {
        phase = "detail";
      }
      return { ok: true };
    },
    type: async () => ({ ok: true }),
    select: async () => ({ ok: true }),
    pressKey: async () => ({ ok: true }),
    hover: async () => ({ ok: true }),
    goBack: async () => ({ ok: true }),
    scroll: async () => ({ ok: true }),
    inspectElement: async (ref) => {
      if (ref === "home-heading") {
        return inspection({
          tag: "h1",
          role: "heading",
          name: "Member",
          text: "Member",
        });
      }
      if (ref === "nav-member") {
        return inspection({
          tag: "a",
          role: "link",
          name: "Member",
          text: "Member",
          href: "/members",
        });
      }
      if (ref === "search") {
        return inspection({ tag: "input", name: "q", testId: "search-input" });
      }
      if (ref === "submit") {
        return inspection({
          tag: "button",
          name: "search",
          testId: "search-submit",
        });
      }
      return inspection({});
    },
    inspectDom: async () => ({ url: "", title: "", candidates: [] }),
  };

  return { browser, clickedRefs, navigatedUrls };
}

test("look_up_member artifact replays for Marcus Chen, not recorded Priya", async () => {
  const artifact = lookUpMemberArtifact();
  assert.equal(artifact.name, "look_up_member");

  assert.equal(JSON.stringify(artifact.steps).includes(PRIYA_MEMBER_ID), false);
  assert.equal(
    JSON.stringify(artifact.steps).includes(`/members/${PRIYA_MEMBER_ID}`),
    false,
  );

  const { browser, clickedRefs, navigatedUrls } = mockBrowserForMarcusReplay();
  const result = await replayArtifact(
    artifact,
    { member_query: "Marcus Chen" },
    browser,
  );

  assert.equal(result.status, "success");
  if (result.status !== "success") return;

  assert.equal(result.outputs.member_id, MARCUS.member_id);
  assert.equal(result.outputs.email, MARCUS.email);
  assert.equal(result.outputs.phone, MARCUS.phone);
  assert.equal(result.outputs.address, MARCUS.address);

  assert.ok(clickedRefs.includes("nav-member"));
  assert.equal(clickedRefs.includes("home-heading"), false);
  assert.ok(clickedRefs.includes(MARCUS_VIEW_REF));
  assert.equal(clickedRefs.includes(PRIYA_VIEW_REF), false);

  assert.ok(navigatedUrls.includes(artifact.startUrl));
  assert.equal(
    navigatedUrls.some((u) => u.includes(`/members/${PRIYA_MEMBER_ID}`)),
    false,
  );
  assert.equal(
    navigatedUrls.some((u) => u.includes(PRIYA_MEMBER_ID)),
    false,
  );
});

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
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const result = await replayArtifact(artifact, {}, browser, {
    pollIntervalMs: 10,
    pollTimeoutMs: 500,
  });
  assert.equal(result.status, "success");
  assert.ok(observes >= 3);
});

test("target remains missing returns recoverable", async () => {
  const browser = baseBrowser({
    observe: async () => ({
      snapshot: `- heading "Empty" [ref=h]`,
      elements: [],
      url: "https://dough-credit-union.vercel.app/",
    }),
    inspectElement: async () =>
      inspection({
        role: "heading",
        rect: { x: 0, y: 0, width: 10, height: 10 },
      }),
  });

  const artifact: WorkflowArtifact = {
    id: "missing-target",
    version: 1,
    kind: "browser_workflow",
    name: "missing_target",
    description: "d",
    sourceRunId: "r",
    startUrl: "https://dough-credit-union.vercel.app/",
    requiresAuthenticatedSession: false,
    inputs: {},
    steps: [{ action: "click", target: { text: "Never" } }],
    outputs: [],
    conditions: [],
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const result = await replayArtifact(artifact, {}, browser, FAST_POLL);
  assert.equal(result.status, "recoverable");
  if (result.status !== "recoverable") return;
  assert.equal(result.code, "target_missing");
  assert.equal(result.retryable, true);
  assert.equal(result.context?.action, "click");
});

test("target ambiguous fails immediately without polling", async () => {
  let observes = 0;
  const browser = baseBrowser({
    observe: async () => {
      observes += 1;
      return {
        snapshot: `
- link "Go" [ref=a]
- link "Go" [ref=b]
`,
        elements: [],
        url: "https://dough-credit-union.vercel.app/",
      };
    },
    inspectElement: async () =>
      inspection({
        role: "link",
        text: "Go",
        name: "Go",
        rect: { x: 0, y: 0, width: 20, height: 10 },
      }),
  });

  const artifact: WorkflowArtifact = {
    id: "ambiguous",
    version: 1,
    kind: "browser_workflow",
    name: "ambiguous",
    description: "d",
    sourceRunId: "r",
    startUrl: "https://dough-credit-union.vercel.app/",
    requiresAuthenticatedSession: false,
    inputs: {},
    steps: [{ action: "click", target: { text: "Go" } }],
    outputs: [],
    conditions: [],
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const started = Date.now();
  const result = await replayArtifact(artifact, {}, browser, {
    pollIntervalMs: 200,
    pollTimeoutMs: 2000,
  });
  const elapsed = Date.now() - started;

  assert.equal(result.status, "failure");
  if (result.status !== "failure") return;
  assert.equal(result.code, "target_ambiguous");
  assert.equal(observes, 1);
  assert.ok(elapsed < 500, `expected immediate fail, took ${elapsed}ms`);
});

test("delayed checkpoint eventually passes", async () => {
  let observes = 0;
  const browser = baseBrowser({
    observe: async () => {
      observes += 1;
      if (observes === 1) {
        return {
          snapshot: `- link "Next" [ref=next]`,
          elements: [],
        };
      }
      // Post-click checkpoint polls
      if (observes < 4) {
        return { snapshot: `- heading "Loading" [ref=h]`, elements: [] };
      }
      return {
        snapshot: `- heading "Ready" [ref=h]`,
        elements: [],
        url: "https://dough-credit-union.vercel.app/ready",
      };
    },
    inspectElement: async (ref) =>
      inspection({
        role: ref === "next" ? "link" : "heading",
        text: ref === "next" ? "Next" : "Ready",
        name: ref === "next" ? "Next" : "Ready",
        rect: { x: 0, y: 0, width: 20, height: 10 },
      }),
  });

  const artifact: WorkflowArtifact = {
    id: "checkpoint-ok",
    version: 1,
    kind: "browser_workflow",
    name: "checkpoint_ok",
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
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const result = await replayArtifact(artifact, {}, browser, {
    pollIntervalMs: 10,
    pollTimeoutMs: 500,
  });
  assert.equal(result.status, "success");
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
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const result = await replayArtifact(artifact, {}, browser, FAST_POLL);
  assert.equal(result.status, "failure");
  if (result.status !== "failure") return;
  assert.equal(result.code, "origin_blocked");
  assert.equal(navigated, false);
});

test("replay cannot bypass risky element policy", async () => {
  let clicked = false;
  const browser = baseBrowser({
    observe: async () => ({
      snapshot: `- button "Confirm transfer" [ref=go]`,
      elements: [],
      url: "https://dough-credit-union.vercel.app/transfer",
    }),
    inspectElement: async () =>
      inspection({
        role: "button",
        name: "Confirm transfer",
        text: "Confirm transfer",
        risk: "risky",
        rect: { x: 0, y: 0, width: 20, height: 10 },
      }),
    click: async () => {
      clicked = true;
      return { ok: true };
    },
  });

  const artifact: WorkflowArtifact = {
    id: "risky-click",
    version: 1,
    kind: "browser_workflow",
    name: "risky_click",
    description: "d",
    sourceRunId: "r",
    startUrl: "https://dough-credit-union.vercel.app/",
    requiresAuthenticatedSession: false,
    inputs: {},
    steps: [{ action: "click", target: { text: "Confirm transfer" } }],
    outputs: [],
    conditions: [],
    createdAt: "2026-09-16T00:00:00.000Z",
  };

  const result = await replayArtifact(artifact, {}, browser, FAST_POLL);
  assert.equal(result.status, "failure");
  if (result.status !== "failure") return;
  assert.equal(result.code, "policy_requires_human");
  assert.equal(clicked, false);
});
