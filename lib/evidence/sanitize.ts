const SENSITIVE_KEY =
  /pass(word|wd)|secret|token|authorization|cookie|credential|api[_-]?key|auth/i;

const SECRET_VALUE =
  /^(bearer\s+\S+|sk-[a-z0-9_-]{8,}|ghp_[a-z0-9]{20,}|xox[baprs]-)/i;

export const REDACTED = "[REDACTED]";

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

function redactString(value: string): string {
  if (SECRET_VALUE.test(value.trim())) return REDACTED;
  return value;
}

/** Deep-sanitize values before persisting evidence JSONL. */
export function sanitizeForEvidence(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitizeForEvidence);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED;
        continue;
      }
      // Never persist raw typed/select literals from tool args.
      if (
        (key === "text" || key === "value") &&
        typeof child === "string" &&
        child.length > 0
      ) {
        out[key] = { length: child.length };
        continue;
      }
      out[key] = sanitizeForEvidence(child);
    }
    return out;
  }
  return String(value);
}

/** Sanitize tool arguments for discovery decision logs. */
export function sanitizeToolArguments(
  name: string,
  args: unknown,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    typeof args === "object" && args !== null && !Array.isArray(args)
      ? { ...(args as Record<string, unknown>) }
      : { value: args };

  const sanitized = sanitizeForEvidence(base) as Record<string, unknown>;

  if (name === "type" && typeof base.text === "string") {
    sanitized.text = { length: base.text.length };
  }
  if (name === "select" && typeof base.value === "string") {
    sanitized.value = { length: base.value.length };
  }

  return sanitized;
}
