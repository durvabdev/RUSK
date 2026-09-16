import { NextResponse } from "next/server";

import {
  interruptFromThrown,
  resumeInterruptedRun,
  waitingResponse,
  type HitlResumeAction,
} from "@/lib/agent/hitl";
import { getAgentRuntime } from "@/lib/agent/runtime";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { runId: rawId } = await context.params;
  const runId = typeof rawId === "string" ? rawId.trim() : "";
  if (!runId) {
    return NextResponse.json(
      { error: "runId is required", status: "failed" },
      { status: 400 },
    );
  }

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Body must be { "action": "resume" | "cancel" }', status: "failed" },
      { status: 400 },
    );
  }

  const action = body.action;
  if (action !== "resume" && action !== "cancel") {
    return NextResponse.json(
      { error: 'action must be "resume" or "cancel"', status: "failed" },
      { status: 400 },
    );
  }

  try {
    const { graph } = await getAgentRuntime();
    const result = await resumeInterruptedRun(
      graph,
      runId,
      action as HitlResumeAction,
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const interrupted = interruptFromThrown(err);
    if (interrupted) {
      const waiting = await waitingResponse(runId, interrupted);
      return NextResponse.json(waiting, { status: 200 });
    }

    const message =
      err instanceof Error ? err.message : String(err);
    const missing =
      /not found|no checkpoint|empty|thread/i.test(message);
    return NextResponse.json(
      {
        runId,
        status: "failed",
        error: message,
        code: missing ? "thread_missing" : "resume_failed",
      },
      { status: missing ? 404 : 500 },
    );
  }
}
