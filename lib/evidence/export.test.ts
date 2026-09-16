import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exportEvidence } from "../../scripts/evidence-export.ts";

test("exportEvidence copies real files and refuses missing", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rusk-ev-"));
  const runs = path.join(tmp, ".rusk", "runs");
  const artifacts = path.join(tmp, ".rusk", "artifacts");
  await fs.mkdir(artifacts, { recursive: true });

  const artifactId = "art-1";
  const discovery = "disc-1";
  const success = "ok-1";
  const exception = "ex-1";

  await fs.writeFile(
    path.join(artifacts, `${artifactId}.json`),
    `${JSON.stringify({ id: artifactId, name: "cap" })}\n`,
  );

  for (const [id, body] of [
    [discovery, `{"event":"discovery_finished","status":"success"}\n`],
    [success, `{"event":"replay_finished","status":"success"}\n`],
    [
      exception,
      `{"event":"condition_detected","code":"member_not_found"}\n{"event":"replay_finished","status":"business_outcome","code":"member_not_found"}\n`,
    ],
  ] as const) {
    const dir = path.join(runs, id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "events.jsonl"), body);
  }

  // tiny fake png
  await fs.writeFile(path.join(runs, exception, "failure.png"), Buffer.from([1, 2, 3]));

  const prev = process.env.RUSK_RUNS_DIR;
  process.env.RUSK_RUNS_DIR = runs;
  try {
    const { copied } = await exportEvidence({
      discoveryRunId: discovery,
      successRunId: success,
      exceptionRunId: exception,
      artifactId,
      cwd: tmp,
    });
    assert.ok(copied.includes("capability.json"));
    assert.ok(copied.includes("discovery-run.jsonl"));
    assert.ok(copied.includes("replay-success.jsonl"));
    assert.ok(copied.includes("replay-exception.jsonl"));
    assert.ok(copied.includes("replay-exception.png"));
    assert.ok(copied.includes("README.md"));

    const cap = await fs.readFile(
      path.join(tmp, "evidence", "capability.json"),
      "utf8",
    );
    assert.ok(cap.includes(artifactId));

    const ex = await fs.readFile(
      path.join(tmp, "evidence", "replay-exception.jsonl"),
      "utf8",
    );
    assert.ok(ex.includes("business_outcome"));
    assert.ok(ex.includes("replay_finished"));

    await assert.rejects(
      () =>
        exportEvidence({
          discoveryRunId: "missing",
          successRunId: success,
          exceptionRunId: exception,
          artifactId,
          cwd: tmp,
        }),
      /Missing required source file/,
    );
  } finally {
    if (prev === undefined) delete process.env.RUSK_RUNS_DIR;
    else process.env.RUSK_RUNS_DIR = prev;
  }
});

test("exportEvidence works without failure.png", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rusk-ev2-"));
  const runs = path.join(tmp, ".rusk", "runs");
  const artifacts = path.join(tmp, ".rusk", "artifacts");
  await fs.mkdir(artifacts, { recursive: true });
  await fs.writeFile(
    path.join(artifacts, "a.json"),
    `${JSON.stringify({ id: "a" })}\n`,
  );
  for (const id of ["d", "s", "e"]) {
    await fs.mkdir(path.join(runs, id), { recursive: true });
    await fs.writeFile(
      path.join(runs, id, "events.jsonl"),
      `{"event":"x"}\n`,
    );
  }
  const prev = process.env.RUSK_RUNS_DIR;
  process.env.RUSK_RUNS_DIR = runs;
  try {
    const { copied } = await exportEvidence({
      discoveryRunId: "d",
      successRunId: "s",
      exceptionRunId: "e",
      artifactId: "a",
      cwd: tmp,
    });
    assert.equal(copied.includes("replay-exception.png"), false);
    assert.ok(copied.includes("README.md"));
  } finally {
    if (prev === undefined) delete process.env.RUSK_RUNS_DIR;
    else process.env.RUSK_RUNS_DIR = prev;
  }
});
