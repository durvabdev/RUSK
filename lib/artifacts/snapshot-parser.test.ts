import assert from "node:assert/strict";
import { test } from "node:test";
import {
  containsPhrase,
  minimalContainersMatchingText,
  parseSnapshotTree,
} from "./snapshot-parser.ts";

test("containsPhrase does not match name prefix (varga vs vargas)", () => {
  assert.equal(containsPhrase("001235 elena varga active tempe", "elena varga"), true);
  assert.equal(
    containsPhrase("001234 elena vargas active phoenix", "elena varga"),
    false,
  );
});

test("minimalContainers picks Varga row only when query is Elena Varga", () => {
  const snapshot = `
- table [ref=t]
  - row [ref=r1]
    - cell "001235" [ref=c1]
    - cell "Elena Varga" [ref=c2]
    - link "View Member" [ref=l1]
  - row [ref=r2]
    - cell "001234" [ref=c3]
    - cell "Elena Vargas" [ref=c4]
    - link "View Member" [ref=l2]
`;
  const containers = minimalContainersMatchingText(
    parseSnapshotTree(snapshot),
    "Elena Varga",
  );
  assert.equal(containers.length, 1);
  assert.equal(containers[0]!.ref, "r1");
});
