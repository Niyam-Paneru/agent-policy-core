/**
 * The policy gate.
 *
 * Every task passes through `evaluatePolicy` before anything else in the system
 * is allowed to look at it. The evaluator is a pure function of
 * (task, registry, now). It performs no I/O, so it can be unit tested
 * exhaustively and replayed against a recorded decision log.
 *
 * Design rule that everything else follows from: **the gate can only narrow
 * what the registry granted.** There is no code path where evaluating a task
 * returns more permission than the registry already contains.
 */

import {
  GLOBAL_EXTERNAL_WRITE_CAP_PER_DAY,
  KNOWN_ORIGIN_OWNERS,
  POLICY_EVIDENCE_MAX_AGE_DAYS,
  POLICY_REGISTRY,
} from "./registry.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Modes that remain safe to offer even when the policy evidence has gone stale. */
const SAFE_FALLBACK_MODES = new Set(["attended_prepare", "manual_only"]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function deny(reason, effectiveMode = "manual_only") {
  return { allowed: false, reason, effectiveMode };
}

export function evidenceIsStale(
  evidence,
  now = new Date(),
  maxAgeDays = POLICY_EVIDENCE_MAX_AGE_DAYS,
) {
  if (!evidence?.reviewed_at) return true;
  const reviewed = Date.parse(`${evidence.reviewed_at}T00:00:00Z`);
  if (!Number.isFinite(reviewed)) return true;
  if (reviewed > now.getTime()) return true;
  return now.getTime() - reviewed > maxAgeDays * DAY_MS;
}

/**
 * Resolves the real target and refuses the three laundering tricks that matter:
 *
 *   - claiming origin A while actually targeting origin B
 *   - embedding credentials in the URL
 *   - serving non-HTTPS (or loopback-only HTTP) traffic
 */
export function parseExactTarget(task) {
  const rawUrl = task?.target?.url;
  const claimedOrigin = task?.target?.origin;

  if (typeof rawUrl !== "string" || typeof claimedOrigin !== "string") {
    return { ok: false, reason: "redirect_outside_allowlist" };
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "redirect_outside_allowlist" };
  }

  const isLoopbackFixture =
    task?.platform === "local_fixture" &&
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname);

  if (
    (!isLoopbackFixture && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.origin !== claimedOrigin
  ) {
    return { ok: false, reason: "redirect_outside_allowlist" };
  }

  return { ok: true, url, origin: url.origin };
}

/** The per-origin entry for `generic_form`, if one was reviewed in. */
function genericDomainRule(origin, policies) {
  const rule = policies?.[origin];
  if (!rule) return null;
  return {
    allowed_actions: ["submit"],
    allowed_modes: Array.isArray(rule.allowed_modes)
      ? [...rule.allowed_modes]
      : ["attended_prepare", "manual_only"],
    site_daily_cap: Number.isInteger(rule.site_daily_cap) ? rule.site_daily_cap : 3,
    evidence: rule.evidence ?? null,
  };
}

/**
 * Provenance for a comment must be an object whose every value is exactly the
 * human-authored marker. Anything else -- missing, empty, array-shaped, or
 * carrying an extra key -- fails closed.
 */
function provenanceAllowed(task) {
  const provenance = task?.content?.provenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    return false;
  }
  const values = Object.values(provenance);
  return values.length > 0 && values.every((v) => v === "human_authored_unedited");
}

/** Action must match the exact path for the platform, not just the origin. */
function actionTargetMatches(action, url) {
  if (action === "comment") {
    return url.pathname === "/item" && /^\d+$/.test(url.searchParams.get("id") ?? "");
  }
  if (action === "submit_story") {
    return url.pathname === "/submit";
  }
  return false;
}

/**
 * A task may request fewer writes than allowed, never more. Values are clamped
 * rather than trusted.
 */
function boundedRequest(value, localMax) {
  if (!Number.isFinite(value)) return localMax;
  return Math.max(0, Math.min(localMax, Math.trunc(value)));
}

export function createPolicyEngine({
  registry = POLICY_REGISTRY,
  now = () => new Date(),
  evidenceMaxAgeDays = POLICY_EVIDENCE_MAX_AGE_DAYS,
} = {}) {
  return function evaluatePolicy(task) {
    const platform = task?.platform;
    const action = task?.action;
    const requestedMode = task?.execution_mode;
    const baseRule = registry.platforms[platform];

    if (!baseRule) return deny("unsupported_platform");
    if (!baseRule.allowed_actions.includes(action)) return deny("unsupported_action");

    const target = parseExactTarget(task);
    if (!target.ok) return deny(target.reason);

    // Origin ownership: a task cannot borrow one platform's permission to act
    // on another platform's origin.
    const owner = KNOWN_ORIGIN_OWNERS[target.origin];
    if (owner && owner !== platform) return deny("redirect_outside_allowlist");

    let rule = baseRule;
    let domainEntry = null;

    if (platform === "generic_form") {
      domainEntry = genericDomainRule(target.origin, baseRule.domain_policies);
      if (domainEntry) rule = { ...baseRule, ...domainEntry };
    } else if (platform === "local_fixture") {
      if (
        target.url.protocol !== "http:" ||
        !LOOPBACK_HOSTS.has(target.url.hostname)
      ) {
        return deny("redirect_outside_allowlist");
      }
    } else if (!baseRule.exact_origins?.includes(target.origin)) {
      return deny("redirect_outside_allowlist");
    }

    if (platform === "news_aggregator") {
      if (!actionTargetMatches(action, target.url)) {
        return deny("redirect_outside_allowlist");
      }
      if (action === "comment" && !provenanceAllowed(task)) {
        return deny("provenance_blocked");
      }
    }

    // Order matters here, and it is deliberate.
    //
    // The mode check runs BEFORE the evidence check so that a refusal always
    // reports the strongest, most permanent reason. "This origin never had
    // browser permission" (mode_not_allowed) is a permanent property of the
    // registry. "Your evidence expired" (policy_evidence_stale) is transient
    // and might lead an operator to believe a re-review would grant browser
    // mode at an origin that was never reviewed at all. It would not.
    //
    // A task may request a mode; it cannot add one the registry never granted.
    if (!rule.allowed_modes.includes(requestedMode)) {
      return {
        allowed: false,
        reason: "mode_not_allowed",
        effectiveMode: rule.allowed_modes.includes("attended_prepare")
          ? "attended_prepare"
          : "manual_only",
      };
    }

    // Stale evidence may preserve only the safe preparation modes. This is the
    // decay mechanism: forget to re-review, and autonomy quietly drops rather
    // than silently continuing at last quarter's permission level.
    const stale =
      platform === "generic_form" && !domainEntry
        ? true
        : evidenceIsStale(rule.evidence, now(), evidenceMaxAgeDays);

    if (stale && !SAFE_FALLBACK_MODES.has(requestedMode)) {
      return {
        allowed: false,
        reason: "policy_evidence_stale",
        effectiveMode: rule.allowed_modes.includes("attended_prepare")
          ? "attended_prepare"
          : "manual_only",
      };
    }

    // Generic forms have no wildcard browser permission. The mode check above
    // already covers the case where no per-origin entry exists. This is a
    // second guard for a future registry edit that adds `supervised_browser` to
    // the generic_form base rule while leaving the wildcard flag false.
    if (
      platform === "generic_form" &&
      requestedMode === "supervised_browser" &&
      !domainEntry?.allowed_modes?.includes("supervised_browser")
    ) {
      return { allowed: false, reason: "mode_not_allowed", effectiveMode: "attended_prepare" };
    }

    const siteMax = boundedRequest(task?.write_caps?.requested_site_daily_max, rule.site_daily_cap);
    const globalMax = boundedRequest(
      task?.write_caps?.requested_global_daily_max,
      GLOBAL_EXTERNAL_WRITE_CAP_PER_DAY,
    );

    return {
      allowed: true,
      reason: null,
      effectiveMode: requestedMode,
      siteMax,
      globalMax,
      localSiteMax: rule.site_daily_cap,
      localGlobalMax: GLOBAL_EXTERNAL_WRITE_CAP_PER_DAY,
      targetOrigin: target.origin,
      policyEvidenceStale: stale,
      registryVersion: registry.registry_version,
    };
  };
}

/**
 * Wraps the evaluator with idempotency. Duplicate and cross-target-repost
 * detection runs only after the policy allows the task, so the ledger never
 * records a refusal as an effect.
 */
export function createPolicyHook({
  dedupe = null,
  policyEngine = createPolicyEngine(),
  crossTargetWindowMs = 7 * DAY_MS,
  now = () => Date.now(),
} = {}) {
  return function policyHook(task) {
    const decision = policyEngine(task);
    if (!decision.allowed) return decision;

    const contentKey = task?.idempotency?.cross_target_content_key;
    if (dedupe && contentKey && task?.target_fingerprint) {
      const duplicate = dedupe.checkCrossTarget({
        contentKey,
        targetFingerprint: task.target_fingerprint,
        windowMs: crossTargetWindowMs,
        now: now(),
      });
      if (duplicate.blocked) {
        return {
          ...decision,
          allowed: false,
          reason: duplicate.reason,
        };
      }
    }

    return decision;
  };
}
