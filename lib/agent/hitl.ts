import {
  Command,
  INTERRUPT,
  isGraphInterrupt,
  isInterrupted,
} from "@langchain/langgraph";

import { appendRunEvent } from "../evidence/run-log";
import type { HumanRequest } from "./human-request";
import { HumanRequestSchema } from "./human-request";

export type HitlResumeAction = "resume" | "cancel";

export type HumanInterruptValue = {
  type: "human_request";
  runId: string;
  request: HumanRequest;
};

export type WaitingForHumanResponse = {
  runId: string;
  status: "waiting_for_human";
  humanRequest: HumanRequest;
  interrupt: HumanInterruptValue;
};

type GraphLike = {
  invoke: (
    input: unknown,
    config?: {
      recursionLimit?: number;
      configurable?: { thread_id: string };
      runName?: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
    },
  ) => Promise<unknown>;
};

function asHumanRequest(raw: unknown): HumanRequest | null {
  const parsed = HumanRequestSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseHumanInterrupt(
  value: unknown,
): HumanInterruptValue | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.type !== "human_request") return null;
  if (typeof v.runId !== "string" || !v.runId) return null;
  const request = asHumanRequest(v.request);
  if (!request) return null;
  return { type: "human_request", runId: v.runId, request };
}

export function interruptFromInvokeResult(
  result: unknown,
): HumanInterruptValue | null {
  if (!isInterrupted(result)) return null;
  const first = result[INTERRUPT]?.[0]?.value;
  return parseHumanInterrupt(first);
}

export function interruptFromThrown(err: unknown): HumanInterruptValue | null {
  if (!isGraphInterrupt(err)) return null;
  const first = err.interrupts?.[0]?.value;
  return parseHumanInterrupt(first);
}

export async function waitingResponse(
  runId: string,
  interrupt: HumanInterruptValue,
): Promise<WaitingForHumanResponse> {
  await appendRunEvent(runId, {
    event: "interrupted",
    requestType: interrupt.request.type,
  });
  return {
    runId,
    status: "waiting_for_human",
    humanRequest: interrupt.request,
    interrupt,
  };
}

export function invokeConfig(runId: string) {
  return {
    recursionLimit: 100,
    configurable: { thread_id: runId },
    runName: "rusk-agent-run",
    tags: ["rusk", "browser-agent"],
    metadata: { runId },
  };
}

/**
 * Resume or cancel an interrupted discovery run on the same thread_id.
 * Does not create a browser or navigate.
 */
export async function resumeInterruptedRun(
  graph: GraphLike,
  runId: string,
  action: HitlResumeAction,
): Promise<
  | WaitingForHumanResponse
  | { runId: string; status: string; [key: string]: unknown }
> {
  await appendRunEvent(runId, {
    event: "human_control",
    action,
  });

  const result = await graph.invoke(
    new Command({ resume: { action } }),
    invokeConfig(runId),
  );

  const again = interruptFromInvokeResult(result);
  if (again) {
    return waitingResponse(runId, again);
  }

  const state = (result ?? {}) as Record<string, unknown>;
  const status =
    typeof state.status === "string" ? state.status : "unknown";

  if (action === "cancel" || status === "cancelled") {
    await appendRunEvent(runId, { event: "cancelled" });
  } else {
    await appendRunEvent(runId, { event: "resumed" });
  }

  return { ...state, runId, status };
}
