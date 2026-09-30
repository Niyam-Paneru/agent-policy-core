/**
 * Append-only ledger.
 *
 * Records are never mutated or deleted. A record that turns out to be wrong is
 * superseded by a later record, not edited. That property is what makes the
 * log usable as evidence: every state the system was in is still there.
 *
 * Redaction happens on write, not on read, so a secret never reaches storage in
 * the first place. Anything that looks like a credential is replaced before the
 * record is appended.
 */

const SENSITIVE_KEY =
  /(authorization|token|password|passwd|cookie|secret|otp|credential|api[_-]?key|pat|session)/i;

const SENSITIVE_QUERY =
  /^(token|access_token|auth|authorization|password|passwd|secret|api[_-]?key|key|otp|code)$/i;

export const EFFECT_PHASES = Object.freeze([
  "effect_intent",
  "effect_confirmed",
  "effect_ambiguous",
]);

export function redactValue(value, depth = 0) {
  if (depth > 8) return "[TRUNCATED]";
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(item, depth + 1);
  }
  return out;
}

export function redactUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return "[INVALID_URL]";
  }
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY.test(key)) url.searchParams.set(key, "[REDACTED]");
  }
  if (url.username || url.password) {
    url.username = "[REDACTED]";
    url.password = "";
  }
  return url.toString();
}

export class Journal {
  #records = [];
  #now;

  constructor({ now = () => new Date() } = {}) {
    this.#now = now;
  }

  get records() {
    return this.#records;
  }

  /** Serialise as JSON Lines. One record per line, append-only, no rewrite. */
  toJSONL() {
    return this.#records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  }

  static fromJSONL(text, { now = () => new Date() } = {}) {
    const journal = new Journal({ now });
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      journal.#records.push(JSON.parse(trimmed));
    }
    return journal;
  }

  append(entry) {
    const record = Object.freeze({
      timestamp: this.#now().toISOString(),
      ...entry,
      payload: entry.payload === undefined ? undefined : redactValue(entry.payload),
      url: entry.url === undefined ? undefined : redactUrl(entry.url),
    });
    this.#records.push(record);
    return record;
  }

  /** Latest record for a given effect key, regardless of phase. */
  getEffectLatest(effectKey) {
    for (let i = this.#records.length - 1; i >= 0; i -= 1) {
      const record = this.#records[i];
      if (record.effect_key === effectKey) return record;
    }
    return null;
  }

  getTaskLatest(taskId) {
    for (let i = this.#records.length - 1; i >= 0; i -= 1) {
      const record = this.#records[i];
      if (record.task_id === taskId && record.task_status) return record;
    }
    return null;
  }
}
