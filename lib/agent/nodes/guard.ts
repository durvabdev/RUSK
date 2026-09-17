import type {
  BrowserController,
  ElementInspection,
} from "../../browser/browser";
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

export const POLICY_APPROVAL_REQUEST = {
  type: "approval" as const,
  message:
    "Risky action requires human approval. Approve or take control in the live browser, then resume.",
};

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

    // --- Shared action policy (before any execute) ---
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

    if (policy.ok) {
      return {};
    }

    if (policy.code === "policy_requires_human") {
      let recordedFormFields: RecordedFormField[] | undefined;
      if (
        ref &&
        shouldCaptureFormFields(call.name, inspectedElement)
      ) {
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
                ...(ref ? { ref } : {}),
                ...(recordedFromInspect.testId
                  ? { testId: recordedFromInspect.testId }
                  : {}),
                ...(recordedFromInspect.role
                  ? { role: recordedFromInspect.role }
                  : {}),
                ...(recordedFromInspect.name
                  ? { name: recordedFromInspect.name }
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

      return {
        decision: {
          type: "human",
          call: null,
          reason: null,
          request: POLICY_APPROVAL_REQUEST,
        },
        humanRequest: POLICY_APPROVAL_REQUEST,
        status: "waiting_for_human",
        ...(pendingCommit ? { pendingCommit } : {}),
      };
    }

    return policyDenyUpdate(policy.code, policy.message);
  };
}
