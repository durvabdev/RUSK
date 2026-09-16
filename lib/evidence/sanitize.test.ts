import assert from "node:assert/strict";
import { test } from "node:test";
import { REDACTED, sanitizeForEvidence, sanitizeToolArguments } from "./sanitize.ts";

test("redacts sensitive keys", () => {
  const out = sanitizeForEvidence({
    password: "secret123",
    token: "abc",
    authorization: "Bearer xyz",
    cookie: "sid=1",
    apiKey: "k",
    ok: "visible",
  }) as Record<string, unknown>;
  assert.equal(out.password, REDACTED);
  assert.equal(out.token, REDACTED);
  assert.equal(out.authorization, REDACTED);
  assert.equal(out.cookie, REDACTED);
  assert.equal(out.apiKey, REDACTED);
  assert.equal(out.ok, "visible");
});

test("redacts bearer/sk secret values", () => {
  assert.equal(sanitizeForEvidence("Bearer abcdef"), REDACTED);
  assert.equal(sanitizeForEvidence("sk-abcdefghijklmnop"), REDACTED);
  assert.equal(sanitizeForEvidence("normal text"), "normal text");
});

test("type/select args store length not raw text", () => {
  const typed = sanitizeToolArguments("type", {
    ref: "e1",
    text: "hunter2",
  });
  assert.deepEqual(typed.text, { length: 7 });
  assert.equal(typed.ref, "e1");

  const selected = sanitizeToolArguments("select", {
    ref: "e2",
    value: "Savings SV-2010",
  });
  assert.deepEqual(selected.value, { length: 15 });
});

test("nested objects are sanitized", () => {
  const out = sanitizeForEvidence({
    call: { name: "type", arguments: { text: "x", password: "y" } },
  }) as { call: { arguments: { text: unknown; password: unknown } } };
  assert.deepEqual(out.call.arguments.text, { length: 1 });
  assert.equal(out.call.arguments.password, REDACTED);
});
