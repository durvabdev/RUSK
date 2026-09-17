import { NextResponse } from "next/server";

import { getAgentRuntime } from "@/lib/agent/runtime";
import { resumeReplay } from "@/lib/artifacts/replay";
import { BrowserControlError } from "@/lib/browser/control";

export const runtime = "nodejs";

type Params = { params: Promise<{ runId: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { runId: rawId } = await params;
  const runId = typeof rawId === "string" ? rawId.trim() : "";
  if (!runId) {
    return NextResponse.json(
      { error: "runId is required", status: "failed" },
      { status: 400 },
    );
  }

  try {
    const { browser } = await getAgentRuntime();
    const result = await resumeReplay(runId, browser);

    if (result.status === "waiting_for_human") {
      return NextResponse.json(result, { status: 200 });
    }
    if (result.status === "success" || result.status === "business_outcome") {
      return NextResponse.json({ ...result, runId }, { status: 200 });
    }
    if (
      result.status === "failure" &&
      (result.code === "run_missing" || result.code === "artifact_missing")
    ) {
      return NextResponse.json({ ...result, runId }, { status: 404 });
    }
    if (result.status === "failure" && result.code === "resume_invalid") {
      return NextResponse.json({ ...result, runId }, { status: 409 });
    }
    return NextResponse.json({ ...result, runId }, { status: 422 });
  } catch (err) {
    if (err instanceof BrowserControlError) {
      return NextResponse.json(
        {
          runId,
          status: "failed",
          code: err.code,
          error: err.message,
        },
        { status: 409 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { runId, status: "failed", error: message },
      { status: 500 },
    );
  }
}
