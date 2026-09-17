import type {
  BrowserController,
  ElementInspection,
} from "../../browser/browser";
import {
  formatApprovalRequest,
  matchApprovalRule,
} from "../../policy/approval";
import {
  evaluateActionPolicy,
  type PolicyElementMeta,
} from "../../policy/evaluate";
import { getPolicyConfig } from "../../policy/config";
import {
  CREDENTIAL_HUMAN_REQUEST,
  detectAuthFormFromDom,
  fromElementInspection,
  isCredentialField,
} from "../auth-form";
import type { RecordedFormField } from "../../artifacts/schema";
import { shouldCaptureFormFields } from "../../artifacts/form-capture";
import type { AgentState, AgentStateUpdate } from "../state";

/** Kept for test import compat */
export const POLICY_APPROVAL_REQUEST = formatApprovalRequest(
  "Close account",
  "Account closure is irreversible",
);

function toolRef(arguments_: unknown): string | null {
  if (
    typeof arguments_ !== "object" ||
    arguments_ === null ||
    !("ref" in arguments_)
  ) {
    return null;
  }
  const ref = (arguments_ as { ref: unknown }).ref;
  return typeof ref === "string" && ref.length > 0 ? ref : null;
}

function toolUrl(arguments_: unknown): string | null {
  if (
    typeof arguments_ !== "object" ||
    arguments_ === null ||
    !("url" in arguments_)
  ) {
    return null;
  }
  const url = (arguments_ as { url: unknown }).url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

function toolKey(arguments_: unknown): string | null {
  if (
    typeof arguments_ !== "object" ||
    arguments_ === null ||
    !("key" in arguments_)
  ) {
    return null;
  }
  const key = (arguments_ as { key: unknown }).key;
  return typeof key === "string" && key.length > 0 ? key : null;
}

function policyDenyUpdate(
  code: string,
  message: string,
): AgentStateUpdate {
  return {
    status: "failed",
    error: `${code}: ${message}`,
    decision: {
      type: "finish",
      call: null,
      reason: message,
      request: null,
    },
  };
}

export function createGuardNode(browser: BrowserController) {
  return async function guardNode(
    state: AgentState,
  ): Promise<AgentStateUpdate> {
    const decision = state.decision;

    if (!decision || decision.type !== "tool" || !decision.call) {
      return {};
    }

    const call = decision.call;
    const ref = toolRef(call.arguments);

    // --- Credential guard (type on auth forms only) ---
    if (call.name === "type" && ref) {
      const { candidates } = await browser.inspectDom();
      const auth = detectAuthFormFromDom(candidates);

      if (auth.isAuthForm) {
        let target;
        try {
          target = await browser.inspectElement(ref);
        } catch {
          return {
            decision: {
              type: "human",
              call: null,
              reason: null,
              request: CREDENTIAL_HUMAN_REQUEST,
            },
            humanRequest: CREDENTIAL_HUMAN_REQUEST,
            status: "waiting_for_human",
            authRequired: true,
          };
        }

        if (isCredentialField(fromElementInspection(target))) {
          return {
            decision: {
              type: "human",
              call: null,
              reason: null,
              request: CREDENTIAL_HUMAN_REQUEST,
            },
            humanRequest: CREDENTIAL_HUMAN_REQUEST,
            status: "waiting_for_human",
            authRequired: true,
          };
        }
      }
    }

    // --- Inspect for approval match + origin/action policy ---
    let inspectedElement: ElementInspection | null = null;

    if (ref && ["click", "type", "select"].includes(call.name)) {
      try {
        inspectedElement = await browser.inspectElement(ref);
      } catch {
        inspectedElement = null;
      }
    }

    const recordedFromInspect = inspectedElement
      ? {
          role: inspectedElement.role,
          name: inspectedElement.name,
          text: inspectedElement.text,
          href: inspectedElement.href,
          type: inspectedElement.type,
          testId: inspectedElement.testId,
          placeholder: inspectedElement.placeholder,
          risk: inspectedElement.risk,
          actionCategory: inspectedElement.actionCategory,
          tag: inspectedElement.tag,
          ariaLabel: inspectedElement.ariaLabel,
        }
      : null;

    const element: PolicyElementMeta | null = recordedFromInspect
      ? {
          risk: recordedFromInspect.risk as PolicyElementMeta["risk"],
          actionCategory: recordedFromInspect.actionCategory,
          role: recordedFromInspect.role,
          name: recordedFromInspect.name,
          href: recordedFromInspect.href,
          type: recordedFromInspect.type,
          text: recordedFromInspect.text,
        }
      : null;

    const policy = evaluateActionPolicy(
      {
        action: call.name,
        currentUrl: state.observation?.url ?? null,
        navigateUrl:
          call.name === "navigate" ? toolUrl(call.arguments) : null,
        element,
        key: call.name === "press_key" ? toolKey(call.arguments) : null,
      },
      getPolicyConfig(),
    );

    // Hard denials only — discovery ignores classifier require_human.
    if (
      !policy.ok &&
      policy.code !== "policy_requires_human"
    ) {
      return policyDenyUpdate(policy.code, policy.message);
    }

    // Explicit approval policy (discovery) — not classifyRisk.
    const approvalRule = matchApprovalRule(call.name, {
      role: recordedFromInspect?.role ?? null,
      name: recordedFromInspect?.name ?? recordedFromInspect?.ariaLabel ?? null,
      text: recordedFromInspect?.text ?? null,
      tag: recordedFromInspect?.tag ?? null,
    });

    if (approvalRule) {
      const targetName =
        recordedFromInspect?.name ??
        recordedFromInspect?.ariaLabel ??
        recordedFromInspect?.text ??
        approvalRule.name;
      const request = formatApprovalRequest(
        targetName,
        approvalRule.reason,
      );

      let recordedFormFields: RecordedFormField[] | undefined;
      if (ref && shouldCaptureFormFields(call.name, inspectedElement)) {
        try {
          const fields = await browser.captureFormFields(ref);
          if (fields.length > 0) recordedFormFields = fields;
        } catch {
          /* non-fatal */
        }
      }

      const pendingCommit =
        recordedFromInspect &&
        ["click", "type", "select"].includes(call.name)
          ? {
              toolCall: { name: call.name, arguments: call.arguments },
              recordedTarget: {
                ...(recordedFromInspect.testId
                  ? { testId: recordedFromInspect.testId }
                  : {}),
                ...((recordedFromInspect.role ||
                  recordedFromInspect.tag === "button" ||
                  recordedFromInspect.tag === "a")
                  ? {
                      role:
                        recordedFromInspect.role ??
                        (recordedFromInspect.tag === "button"
                          ? "button"
                          : recordedFromInspect.tag === "a"
                            ? "link"
                            : recordedFromInspect.role),
                    }
                  : {}),
                ...(recordedFromInspect.name || recordedFromInspect.text
                  ? {
                      name:
                        recordedFromInspect.name ??
                        recordedFromInspect.text ??
                        undefined,
                    }
                  : {}),
                ...(recordedFromInspect.text
                  ? { text: recordedFromInspect.text }
                  : {}),
                ...(recordedFromInspect.href
                  ? { href: recordedFromInspect.href }
                  : {}),
                ...(recordedFromInspect.placeholder
                  ? { placeholder: recordedFromInspect.placeholder }
                  : {}),
              },
              ...(recordedFormFields ? { recordedFormFields } : {}),
            }
          : null;

      // #region agent log
      fetch('http://127.0.0.1:7664/ingest/fd9e0927-3b2b-4655-99d8-b10f5823d4d8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'78d987'},body:JSON.stringify({sessionId:'78d987',hypothesisId:'B',location:'guard.ts:approval',message:'guard set pendingCommit',data:{hasPendingCommit:!!pendingCommit,target:{testId:pendingCommit?.recordedTarget?.testId??null,role:pendingCommit?.recordedTarget?.role??null,name:pendingCommit?.recordedTarget?.name??null,text:pendingCommit?.recordedTarget?.text??null,tag:recordedFromInspect?.tag??null}},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      return {
        decision: {
          type: "human",
          call: null,
          reason: null,
          request,
        },
        humanRequest: request,
        status: "waiting_for_human",
        approvalStatus: "pending",
        pendingApproval: {
          toolCall: { name: call.name, arguments: call.arguments },
          target: {
            role: recordedFromInspect?.role ?? "button",
            name: targetName,
          },
          reason: approvalRule.reason,
        },
        ...(pendingCommit ? { pendingCommit } : {}),
      };
    }

    return {};
  };
}
