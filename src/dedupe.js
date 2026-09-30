/**
 * Idempotency.
 *
 * The interesting decision is in `checkEffect`. A system that only blocks on
 * `effect_confirmed` will happily retry a request whose outcome it never
 * learned -- and retrying an unconfirmed external write is how you post the same
 * thing twice.
 *
 * So three phases are hard blocks:
 *
 *   effect_intent    - we said we were going to do this
 *   effect_confirmed - we know it succeeded
 *   effect_ambiguous - we do not know whether it succeeded
 *
 * `effect_ambiguous` is the one that matters. Uncertainty is treated as a
 * positive reason to stop, not as permission to try again.
 */

import { EFFECT_PHASES } from "./journal.js";

const HARD_BLOCK_PHASES = new Set(EFFECT_PHASES);

const TERMINAL_TASK_STATUSES = new Set([
  "done",
  "failed",
  "cancelled",
  "needs_review",
]);

export class Dedupe {
  constructor(journal) {
    this.journal = journal;
  }

  checkEffect(effectKey) {
    const latest = this.journal.getEffectLatest(effectKey);
    if (!latest) return { blocked: false };

    if (HARD_BLOCK_PHASES.has(latest.phase)) {
      return {
        blocked: true,
        reason:
          latest.phase === "effect_confirmed"
            ? "duplicate_effect"
            : latest.phase === "effect_ambiguous"
              ? "ambiguous_side_effect"
              : "duplicate_intent",
        phase: latest.phase,
        record: latest,
      };
    }

    return { blocked: false };
  }

  checkTask(taskId) {
    const latest = this.journal.getTaskLatest(taskId);
    if (!latest) return { blocked: false };

    if (TERMINAL_TASK_STATUSES.has(latest.task_status)) {
      return { blocked: true, reason: "duplicate_effect", record: latest };
    }
    return { blocked: false, record: latest };
  }

  /**
   * Blocks the same content being posted to a *different* target inside the
   * dedupe window. Re-posting one thing across several communities is still one
   * piece of work, not several, and it is a strong signal of automation.
   *
   * Note the explicit `target_fingerprint === target` exclusion: sending the
   * same content twice to the same target is caught by `checkEffect`, not here.
   */
  checkCrossTarget({ contentKey, targetFingerprint, windowMs, now = Date.now() }) {
    if (!windowMs || windowMs <= 0) return { blocked: false };

    const cutoff = now - windowMs;
    for (let i = this.journal.records.length - 1; i >= 0; i -= 1) {
      const record = this.journal.records[i];
      if (record.phase !== "effect_confirmed" && record.phase !== "effect_ambiguous") {
        continue;
      }
      if (record.cross_target_content_key !== contentKey) continue;
      if (record.target_fingerprint === targetFingerprint) continue;
      const time = Date.parse(record.timestamp);
      if (Number.isFinite(time) && time >= cutoff) {
        return {
          blocked: true,
          reason: "duplicate_content_cross_target",
          record,
        };
      }
    }
    return { blocked: false };
  }
}
