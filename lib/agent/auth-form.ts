import type { DomCandidate } from "../browser/dom-inspect";
import type { ElementInspection } from "../browser/browser";

export type AuthFieldMeta = {
  type?: string | null;
  name?: string | null;
  ariaLabel?: string | null;
  placeholder?: string | null;
  autocomplete?: string | null;
  role?: string | null;
  text?: string | null;
};

export function fromDomCandidate(candidate: DomCandidate): AuthFieldMeta {
  return {
    type: candidate.inputType,
    name: candidate.name,
    ariaLabel: candidate.ariaLabel,
    placeholder: candidate.placeholder,
    autocomplete: null,
    role: candidate.role,
    text: candidate.text,
  };
}

export function fromElementInspection(
  element: ElementInspection,
): AuthFieldMeta {
  return {
    type: element.type,
    name: element.name,
    ariaLabel: element.ariaLabel,
    placeholder: element.placeholder,
    autocomplete: element.autocomplete,
    role: element.role,
    text: element.text,
  };
}

export function normalizeFieldText(element: AuthFieldMeta): string {
  return [
    element.name,
    element.ariaLabel,
    element.placeholder,
    element.autocomplete,
    element.role,
    element.text,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function isPasswordField(element: AuthFieldMeta): boolean {
  const text = normalizeFieldText(element);
  const type = element.type?.toLowerCase() ?? "";

  return (
    type === "password" ||
    text.includes("password") ||
    text.includes("current-password") ||
    text.includes("new-password") ||
    text.includes("passcode") ||
    text.includes("pin") ||
    text.includes("otp") ||
    text.includes("verification code") ||
    text.includes("one-time")
  );
}

export function isUsernameField(element: AuthFieldMeta): boolean {
  const text = normalizeFieldText(element);

  return (
    text.includes("username") ||
    text.includes("user name") ||
    text.includes("user id") ||
    text.includes("userid") ||
    text.includes("login id") ||
    text.includes("member login") ||
    text.includes("email") ||
    text.includes("account id") ||
    text.includes("signin") ||
    text.includes("sign in") ||
    (element.autocomplete?.toLowerCase().includes("username") ?? false) ||
    (element.autocomplete?.toLowerCase() === "email")
  );
}

export function isCredentialField(element: AuthFieldMeta): boolean {
  return isUsernameField(element) || isPasswordField(element);
}

export function detectAuthForm(elements: AuthFieldMeta[]) {
  const password = elements.find(isPasswordField);
  const username = elements.find(isUsernameField);

  return {
    isAuthForm: Boolean(password && username),
    username: username ?? null,
    password: password ?? null,
  };
}

export function detectAuthFormFromDom(candidates: DomCandidate[]) {
  return detectAuthForm(candidates.map(fromDomCandidate));
}

export const CREDENTIAL_HUMAN_REQUEST = {
  type: "credential" as const,
  message:
    "Authentication is required. Please enter the username and password directly in the browser, then resume the run.",
};
