import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserController, ElementInspection } from "../browser/browser.ts";
import { resolveTarget } from "./resolve-target.ts";

function inspection(partial: Partial<ElementInspection> = {}): ElementInspection {
  return {
    tag: "a",
    role: "link",
    text: "Member",
    ariaLabel: null,
    name: "Member",
    type: null,
    href: "/members",
    placeholder: null,
    autocomplete: null,
    testId: null,
    contentEditable: false,
    disabled: false,
    readOnly: false,
    value: null,
    rect: { x: 0, y: 0, width: 40, height: 20 },
    ...partial,
  };
}

function mockBrowser(
  byRef: Record<string, ElementInspection> = {},
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
    inspectElement: async (ref) => byRef[ref] ?? inspection(),
    inspectDom: async () => ({ url: "", title: "", candidates: [] }),
  };
}

test("text Member prefers interactive link over heading", async () => {
  const snapshot = `
- heading "Member" [ref=h1]
- link "Member" [ref=nav-member]
`;
  const result = await resolveTarget(
    { text: "Member" },
    snapshot,
    mockBrowser({
      h1: inspection({
        tag: "h1",
        role: "heading",
        rect: { x: 0, y: 0, width: 100, height: 30 },
      }),
      "nav-member": inspection({ role: "link" }),
    }),
  );
  assert.deepEqual(result, { ok: true, ref: "nav-member" });
});

test("duplicate Member links pick first visible", async () => {
  const snapshot = `
- link "Member" [ref=desktop]
- link "Member" [ref=mobile]
`;
  const result = await resolveTarget(
    { text: "Member" },
    snapshot,
    mockBrowser({
      desktop: inspection({ role: "link" }),
      mobile: inspection({
        role: "link",
        rect: { x: 0, y: 0, width: 0, height: 0 },
      }),
    }),
  );
  assert.deepEqual(result, { ok: true, ref: "desktop" });
});

test("two fully visible duplicates are target_ambiguous", async () => {
  const snapshot = `
- link "Member" [ref=desktop]
- link "Member" [ref=mobile]
`;
  const result = await resolveTarget(
    { text: "Member" },
    snapshot,
    mockBrowser({
      desktop: inspection({ role: "link" }),
      mobile: inspection({ role: "link" }),
    }),
  );
  assert.deepEqual(result, { ok: false, code: "target_ambiguous" });
});

test("testId wins when HTML name differs from a11y name", async () => {
  const snapshot = `
- searchbox "Member ID or name" [ref=search]
`;
  const result = await resolveTarget(
    { testId: "search-input", role: "searchbox", name: "q" },
    snapshot,
    mockBrowser({
      search: inspection({
        tag: "input",
        role: "searchbox",
        name: "q",
        testId: "search-input",
        rect: { x: 0, y: 0, width: 100, height: 20 },
      }),
    }),
  );
  assert.deepEqual(result, { ok: true, ref: "search" });
});
