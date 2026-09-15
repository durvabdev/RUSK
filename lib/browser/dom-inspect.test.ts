import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capDomCandidates,
  clampDomLimit,
  DEFAULT_DOM_CANDIDATE_LIMIT,
  MAX_DOM_CANDIDATE_LIMIT,
  rankDomCandidates,
  trimDomText,
  type DomCandidate,
} from "./dom-inspect.ts";

function candidate(partial: Partial<DomCandidate>): DomCandidate {
  return {
    tag: "div",
    role: null,
    text: null,
    ariaLabel: null,
    name: null,
    inputType: null,
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

test("trimDomText collapses whitespace and truncates", () => {
  assert.equal(trimDomText("  hello   world  "), "hello world");
  assert.equal(trimDomText(""), null);
  assert.equal(trimDomText(null), null);
  const long = "a".repeat(200);
  const trimmed = trimDomText(long, 10);
  assert.equal(trimmed?.length, 10);
  assert.ok(trimmed?.endsWith("…"));
});

test("clampDomLimit respects defaults and max", () => {
  assert.equal(clampDomLimit(), DEFAULT_DOM_CANDIDATE_LIMIT);
  assert.equal(clampDomLimit(0), 1);
  assert.equal(clampDomLimit(999), MAX_DOM_CANDIDATE_LIMIT);
});

test("rankDomCandidates prefers visible interactive controls", () => {
  const ranked = rankDomCandidates([
    candidate({ tag: "div", visible: false, text: "x" }),
    candidate({ tag: "button", visible: true, text: "OK", selector: "#ok" }),
    candidate({ tag: "div", visible: true, text: "noise" }),
  ]);
  assert.equal(ranked[0]?.tag, "button");
});

test("capDomCandidates limits length after ranking", () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    candidate({ tag: "button", text: String(i), visible: true }),
  );
  assert.equal(capDomCandidates(many, 3).length, 3);
});
