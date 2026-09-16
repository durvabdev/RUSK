import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserController, ElementInspection } from "../browser/browser.ts";
import { replayArtifact } from "./replay.ts";
import type { WorkflowArtifact } from "./schema.ts";

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
