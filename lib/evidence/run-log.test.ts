import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { appendRunEvent, getRunDir, writeRunMeta } from "./run-log.ts";

test("appendRunEvent writes sanitized JSONL and meta", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rusk-runs-"));
  const prev = process.env.RUSK_RUNS_DIR;
  process.env.RUSK_RUNS_DIR = path.join(tmp, "runs");
  try {
    const runId = "run-test-1";
    await writeRunMeta(runId, { kind: "discovery" });
    await appendRunEvent(runId, {
      event: "decision",
      arguments: { text: "secret", password: "x" },
    });

    const dir = getRunDir(runId);
    const line = (await fs.readFile(path.join(dir, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")[0]!;
    const parsed = JSON.parse(line) as {
      runId: string;
      event: string;
      arguments: { text: unknown; password: unknown };
    };
    assert.equal(parsed.runId, runId);
    assert.equal(parsed.event, "decision");
    assert.deepEqual(parsed.arguments.text, { length: 6 });
    assert.equal(parsed.arguments.password, "[REDACTED]");

    const meta = JSON.parse(
      await fs.readFile(path.join(dir, "meta.json"), "utf8"),
    ) as { kind: string; runId: string };
    assert.equal(meta.kind, "discovery");
    assert.equal(meta.runId, runId);
  } finally {
    if (prev === undefined) delete process.env.RUSK_RUNS_DIR;
    else process.env.RUSK_RUNS_DIR = prev;
  }
});
