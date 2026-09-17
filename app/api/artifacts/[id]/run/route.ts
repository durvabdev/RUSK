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

  // #region agent log
  fetch("http://127.0.0.1:7664/ingest/fd9e0927-3b2b-4655-99d8-b10f5823d4d8", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "78d987",
    },
    body: JSON.stringify({
      sessionId: "78d987",
      runId,
      hypothesisId: "C",
      location: "app/api/artifacts/[id]/run/route.ts",
      message: "replayArtifact finished",
      data: {
        artifactId: id,
        status: result.status,
        code: "code" in result ? result.code : null,
        message:
          "message" in result && typeof result.message === "string"
            ? result.message.slice(0, 200)
            : null,
        inputKeyCount: Object.keys(body.inputs as object).length,
        requiredInputCount: Object.values(artifact.inputs).filter(
          (d) => d.required,
        ).length,
        optionalWithDefault: Object.entries(artifact.inputs)
          .filter(([, d]) => !d.required && d.default !== undefined)
          .map(([k]) => k),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const status = result.status === "success" ? 200 : 422;
  return NextResponse.json({ ...result, runId }, { status });
}
