import { getLogContext, isSensitiveLogKey, logEvent } from "@/lib/logging";

/**
 * Audit trail for operations that destroy data or change configuration.
 *
 * A record answers four questions: which action ran, on what target, for whom,
 * and whether it succeeded. Credentials and request bodies never reach it:
 * details are copied from an explicit primitive allow-list, and fields whose
 * names denote secrets are dropped before the record is written.
 */

export type AuditOutcome = "success" | "failure";

export interface AuditInput {
  /** Stable dotted name, e.g. `session.delete` or `models.config.write`. */
  action: unknown;
  /** The object the action applied to: a session id, path, role, or provider. */
  target?: unknown;
  outcome: unknown;
  /** Bounded, non-secret context. Objects and arrays are deliberately dropped. */
  details?: Record<string, unknown>;
}

const MAX_TARGET_LENGTH = 200;
const MAX_DETAIL_VALUE_LENGTH = 200;
const MAX_DETAIL_KEYS = 12;
const REDACTED = "redacted";
const FALLBACK_ACTION = "unknown";

const ACTION_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const USERINFO_PATTERN = /\/\/[^/@\s]+@/g;

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

/** Strip userinfo, query values, and fragments from one absolute URL. */
function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, REDACTED);
    return url.toString();
  } catch {
    return raw.replace(USERINFO_PATTERN, "//");
  }
}

/**
 * Sanitize a label that may embed a URL (plugin sources, MCP endpoints) so the
 * record names the target without carrying credentials or query values.
 */
export function sanitizeAuditTarget(target: unknown): string | undefined {
  if (typeof target !== "string") return undefined;
  const trimmed = target.trim();
  if (!trimmed) return undefined;
  const redacted = trimmed.replace(URL_PATTERN, (match) => redactUrl(match));
  return truncate(redacted, MAX_TARGET_LENGTH);
}

function sanitizeDetailValue(value: unknown): unknown {
  if (typeof value === "string") return truncate(value, MAX_DETAIL_VALUE_LENGTH);
  if (typeof value === "boolean" || value === null) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value instanceof Error) {
    return {
      name: value.name || "Error",
      message: truncate(value.message, MAX_DETAIL_VALUE_LENGTH),
    };
  }
  // Objects, arrays, buffers, and request bodies have no bounded, secret-free
  // representation here, so they are never copied.
  return undefined;
}

/** Copy only bounded primitives, dropping keys that denote credentials. */
export function sanitizeAuditDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!details || typeof details !== "object") return {};
  const result: Record<string, unknown> = {};
  let copied = 0;
  for (const [key, value] of Object.entries(details)) {
    if (isSensitiveLogKey(key)) continue;
    if (copied >= MAX_DETAIL_KEYS) {
      result._truncated = "additional details omitted";
      break;
    }
    const sanitized = sanitizeDetailValue(value);
    if (sanitized === undefined) continue;
    result[key] = sanitized;
    copied += 1;
  }
  return result;
}

function sanitizeAction(action: unknown): string {
  if (typeof action !== "string") return FALLBACK_ACTION;
  const trimmed = action.trim();
  return ACTION_PATTERN.test(trimmed) ? trimmed : FALLBACK_ACTION;
}

/**
 * Write one `audit.*` record. Actor and request id come from the active request
 * context; a call outside one records the operation without correlation.
 * Logging is a side channel, so this never throws.
 */
export function recordAudit(input: AuditInput | undefined): void {
  try {
    if (!input || typeof input !== "object") return;
    const action = sanitizeAction(input.action);
    const outcome: AuditOutcome = input.outcome === "success" ? "success" : "failure";
    const context = getLogContext();
    const target = sanitizeAuditTarget(input.target);
    logEvent(outcome === "success" ? "info" : "warn", "audit", `audit.${action}`, {
      action,
      outcome,
      ...(target ? { target } : {}),
      ...(context?.actor ? { actor: context.actor } : {}),
      ...(context?.requestId ? { requestId: context.requestId } : {}),
      ...sanitizeAuditDetails(input.details),
    });
  } catch {
    // An audit write must never break the operation it describes.
  }
}

export function auditSuccess(
  action: string,
  target?: unknown,
  details?: Record<string, unknown>,
): void {
  recordAudit({ action, target, outcome: "success", details });
}

export function auditFailure(
  action: string,
  target?: unknown,
  details?: Record<string, unknown>,
): void {
  recordAudit({ action, target, outcome: "failure", details });
}
