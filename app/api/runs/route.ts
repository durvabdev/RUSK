import { NextResponse } from "next/server";

import {
  interruptFromInvokeResult,
  interruptFromThrown,
  invokeConfig,
  waitingResponse,
} from "@/lib/agent/hitl";
import { getAgentRuntime } from "@/lib/agent/runtime";
import {
  BrowserControlError,
  claimAutomation,
  releaseBrowserControl,
  transferToHuman,
} from "@/lib/browser/control";
import { writeRunMeta } from "@/lib/evidence/run-log";
import { evaluateActionPolicy } from "@/lib/policy/evaluate";

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

  const originDecision = evaluateActionPolicy({
    action: "navigate",
    navigateUrl: url,
  });
  if (!originDecision.ok) {
    return NextResponse.json(
      {
        runId,
        url,
        goal,
        status: "failed",
        code: originDecision.code,
        error: originDecision.message,
      },
      { status: 403 },
    );
  }

  try {
    claimAutomation(runId, { supersede: true });

    const { graph, browser } =
      await getAgentRuntime();

    await writeRunMeta(runId, { kind: "discovery" });

    await browser.navigate(url);

    let result: unknown;
    try {
      result = await graph.invoke(
        {
          runId,
          goal,
          startUrl: url,
          recordArtifact,
        },
        {
          ...invokeConfig(runId),
          metadata: {
            runId,
            targetUrl: url,
          },
        },
      );
    } catch (err) {
      const interrupted = interruptFromThrown(err);
      if (interrupted) {
        transferToHuman(runId);
        const waiting = await waitingResponse(runId, interrupted);
        return NextResponse.json(
          { ...waiting, url, goal },
          { status: 201 },
        );
      }
      releaseBrowserControl(runId);
      throw err;
    }

    const interrupted = interruptFromInvokeResult(result);
    if (interrupted) {
      transferToHuman(runId);
      const waiting = await waitingResponse(runId, interrupted);
      return NextResponse.json(
        { ...waiting, url, goal },
        { status: 201 },
      );
    }

    releaseBrowserControl(runId);
    const state = result as Record<string, unknown>;

    return NextResponse.json(
      {
        ...state,
        runId,
        url,
        goal,
        ...(state.artifactId ? { artifactId: state.artifactId } : {}),
        ...(state.artifactError
          ? { artifactError: state.artifactError }
          : {}),
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof BrowserControlError) {
      return NextResponse.json(
        {
          runId,
          url,
          goal,
          status: "failed",
          code: err.code,
          error: err.message,
        },
        { status: 409 },
      );
    }

    releaseBrowserControl(runId);
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
