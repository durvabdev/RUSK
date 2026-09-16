import { NextResponse } from "next/server";

import { createArtifactRepository } from "@/lib/artifacts/repository";
import { replayArtifact } from "@/lib/artifacts/replay";
import { getAgentRuntime } from "@/lib/agent/runtime";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  let body: { inputs?: unknown };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "inputs object required" }, { status: 400 });
  }

  if (
    typeof body.inputs !== "object" ||
    body.inputs === null ||
    Array.isArray(body.inputs)
  ) {
    return NextResponse.json({ error: "inputs object required" }, { status: 400 });
  }

  const repo = createArtifactRepository();
  const artifact = await repo.get(id);

  if (!artifact) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  const runId = crypto.randomUUID();
  const { browser } = await getAgentRuntime();
  const result = await replayArtifact(
    artifact,
    body.inputs as Record<string, unknown>,
    browser,
    { runId },
  );

  const status = result.status === "success" ? 200 : 422;
  return NextResponse.json({ ...result, runId }, { status });
}
