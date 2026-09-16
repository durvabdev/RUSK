import { NextResponse } from "next/server";

import { compileArtifact } from "@/lib/artifacts/compiler";
import { createArtifactRepository } from "@/lib/artifacts/repository";
import { getAgentRuntime } from "@/lib/agent/runtime";

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

  try {
    const { graph, browser } =
      await getAgentRuntime();

    await browser.navigate(url);

    // setting recursion limit to 50
    const result = await graph.invoke(
      {
        runId,
        goal,
        startUrl: url,
      },
      {
        configurable: {
          thread_id: runId,
          recursionLimit: 100,
        },
        runName: "rusk-agent-run",
        tags: ["rusk", "browser-agent"],
        metadata: {
          runId,
          targetUrl: url,
        },
      },
    );

    let artifactId: string | undefined;
    let artifactError: string | undefined;

    if (result.status === "success") {
      try {
        const artifact = compileArtifact(result);
        const repo = createArtifactRepository();
        await repo.save(artifact);
        artifactId = artifact.id;
      } catch (err) {
        artifactError =
          err instanceof Error ? err.message : String(err);
      }
    }

    return NextResponse.json(
      {
        ...result,
        runId,
        url,
        goal,
        ...(artifactId ? { artifactId } : {}),
        ...(artifactError ? { artifactError } : {}),
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
