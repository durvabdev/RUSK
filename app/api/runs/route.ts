import { NextResponse } from "next/server";

import { getAgentRuntime } from "@/lib/agent/runtime";
import { writeRunMeta } from "@/lib/evidence/run-log";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: {
    url?: unknown;
    goal?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "url and goal are required" },
      { status: 400 },
    );
  }

  const url =
    typeof body.url === "string"
      ? body.url.trim()
      : "";

  const goal =
    typeof body.goal === "string"
      ? body.goal.trim()
      : "";

  if (!url || !goal) {
    return NextResponse.json(
      { error: "url and goal are required" },
      { status: 400 },
    );
  }

  try {
    const parsed = new URL(url);

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      throw new Error();
    }
  } catch {
    return NextResponse.json(
      { error: "url must be a valid http(s) URL" },
      { status: 400 },
    );
  }

  const runId = crypto.randomUUID();
  const recordArtifact = process.env.RUSK_RECORD_ARTIFACTS !== "0";

  try {
    const { graph, browser } =
      await getAgentRuntime();

    await writeRunMeta(runId, { kind: "discovery" });

    await browser.navigate(url);

    const result = await graph.invoke(
      {
        runId,
        goal,
        startUrl: url,
        recordArtifact,
      },
      {
        recursionLimit: 100,
        configurable: {
          thread_id: runId,
        },
        runName: "rusk-agent-run",
        tags: ["rusk", "browser-agent"],
        metadata: {
          runId,
          targetUrl: url,
        },
      },
    );

    return NextResponse.json(
      {
        ...result,
        runId,
        url,
        goal,
        ...(result.artifactId ? { artifactId: result.artifactId } : {}),
        ...(result.artifactError
          ? { artifactError: result.artifactError }
          : {}),
      },
      { status: 201 },
    );
  } catch (err) {
    const error =
      err instanceof Error
        ? err.message
        : String(err);

    return NextResponse.json(
      {
        runId,
        url,
        goal,
        status: "failed",
        error,
      },
      { status: 500 },
    );
  }
}
