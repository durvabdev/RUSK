export type DomRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DomCandidate = {
  tag: string;
  role: string | null;
  text: string | null;
  ariaLabel: string | null;
  name: string | null;
  inputType: string | null;
  href: string | null;
  placeholder: string | null;
  contentEditable: boolean;
  disabled: boolean;
  readOnly: boolean;
  value: string | null;
  visible: boolean;
  rect: DomRect;
  selector: string | null;
};

export const DEFAULT_DOM_CANDIDATE_LIMIT = 40;
export const MAX_DOM_CANDIDATE_LIMIT = 80;
export const DOM_TEXT_MAX_LEN = 120;

export function clampDomLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) {
    return DEFAULT_DOM_CANDIDATE_LIMIT;
  }
  return Math.min(MAX_DOM_CANDIDATE_LIMIT, Math.max(1, Math.floor(limit)));
}

export function trimDomText(
  value: string | null | undefined,
  max = DOM_TEXT_MAX_LEN,
): string | null {
  if (value == null) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

export function rankDomCandidates(candidates: DomCandidate[]): DomCandidate[] {
  return [...candidates].sort((a, b) => score(b) - score(a));
}

function score(candidate: DomCandidate): number {
  let value = 0;
  if (candidate.visible) value += 10;
  if (candidate.disabled) value -= 5;
  if (candidate.readOnly && !candidate.contentEditable) value -= 1;
  if (["button", "a", "input", "textarea", "select"].includes(candidate.tag)) {
    value += 4;
  }
  if (candidate.role) value += 2;
  if (candidate.text || candidate.ariaLabel || candidate.name) value += 2;
  if (candidate.contentEditable || candidate.inputType) value += 2;
  if (candidate.selector) value += 1;
  return value;
}

export function capDomCandidates(
  candidates: DomCandidate[],
  limit?: number,
): DomCandidate[] {
  return rankDomCandidates(candidates).slice(0, clampDomLimit(limit));
}

/**
 * Browser-side collector. Serialized into page.evaluate — keep self-contained.
 * Returns raw candidates; Node applies trim/cap/rank.
 */
export function collectDomCandidatesInPage(textMaxLen: number): DomCandidate[] {
  const TEXT_MAX = textMaxLen;

  function trim(value: string | null | undefined): string | null {
    if (value == null) return null;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return null;
    if (normalized.length <= TEXT_MAX) return normalized;
    return `${normalized.slice(0, TEXT_MAX - 1)}…`;
  }

  function isVisible(el: Element): boolean {
    const html = el as HTMLElement;
    const style = window.getComputedStyle(html);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }
    const rect = html.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    if (
      rect.bottom < 0 ||
      rect.right < 0 ||
      rect.top > window.innerHeight ||
      rect.left > window.innerWidth
    ) {
      return false;
    }
    return true;
  }

  function shortSelector(el: Element): string | null {
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }

    const role = el.getAttribute("role");
    const name =
      el.getAttribute("aria-label") ||
      (el as HTMLInputElement).name ||
      trim(el.textContent)?.slice(0, 40);
    if (role && name) {
      return `[role="${role}"][aria-label="${name.replace(/"/g, '\\"')}"]`;
    }

    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    if (!parent) return tag;
    const siblings = [...parent.children].filter(
      (child) => child.tagName === el.tagName,
    );
    if (siblings.length === 1) {
      const parentSel = parent.id
        ? `#${CSS.escape(parent.id)}`
        : parent.tagName.toLowerCase();
      return `${parentSel} > ${tag}`;
    }
    const index = siblings.indexOf(el) + 1;
    return `${tag}:nth-of-type(${index})`;
  }

  const interactiveRoles = new Set([
    "button",
    "link",
    "textbox",
    "searchbox",
    "checkbox",
    "radio",
    "combobox",
    "listbox",
    "menuitem",
    "option",
    "switch",
    "tab",
    "slider",
  ]);

  const selector = [
    "a[href]",
    "button",
    "input",
    "textarea",
    "select",
    '[contenteditable="true"]',
    "[role]",
    "[onclick]",
    "[tabindex]",
  ].join(",");

  const seen = new Set<Element>();
  const out: DomCandidate[] = [];

  for (const el of document.querySelectorAll(selector)) {
    if (seen.has(el)) continue;
    seen.add(el);

    const role = el.getAttribute("role");
    const tag = el.tagName.toLowerCase();
    const style = window.getComputedStyle(el as HTMLElement);
    const likelyClickable =
      el.hasAttribute("onclick") ||
      el.hasAttribute("tabindex") ||
      style.cursor === "pointer";

    if (role && !interactiveRoles.has(role) && !likelyClickable) {
      if (!["a", "button", "input", "textarea", "select"].includes(tag)) {
        continue;
      }
    }

    if (
      !["a", "button", "input", "textarea", "select"].includes(tag) &&
      el.getAttribute("contenteditable") !== "true" &&
      !role &&
      !likelyClickable
    ) {
      continue;
    }

    const input = el as HTMLInputElement;
    const rect = el.getBoundingClientRect();
    const text = trim(el.textContent);
    const ariaLabel = trim(el.getAttribute("aria-label"));
    const name = trim(input.name || el.getAttribute("name"));
    const value = trim(
      typeof input.value === "string" ? input.value : el.getAttribute("value"),
    );

    if (
      !text &&
      !ariaLabel &&
      !name &&
      !value &&
      !input.placeholder &&
      tag !== "input" &&
      tag !== "textarea" &&
      tag !== "select"
    ) {
      continue;
    }

    out.push({
      tag,
      role,
      text,
      ariaLabel,
      name,
      inputType: tag === "input" ? input.type || "text" : null,
      href: tag === "a" ? trim((el as HTMLAnchorElement).href) : null,
      placeholder: trim(input.placeholder),
      contentEditable:
        el.getAttribute("contenteditable") === "true" ||
        (el as HTMLElement).isContentEditable === true,
      disabled: Boolean(input.disabled || el.getAttribute("aria-disabled") === "true"),
      readOnly: Boolean(input.readOnly),
      value,
      visible: isVisible(el),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      selector: shortSelector(el),
    });
  }

  return out;
}

/** Source string passed to page.evaluate (Playwright serializes the function). */
export async function evaluateDomCandidates(
  page: {
    evaluate: <R>(fn: (textMaxLen: number) => R, arg: number) => Promise<R>;
  },
  limit?: number,
): Promise<DomCandidate[]> {
  const raw = await page.evaluate(collectDomCandidatesInPage, DOM_TEXT_MAX_LEN);
  return capDomCandidates(raw, limit);
}
