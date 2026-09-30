/**
 * The policy registry is the only place a permission can be granted.
 *
 * Three properties matter more than the individual entries:
 *
 *   1. It is deeply frozen. No runtime code path can widen a permission after
 *      the registry is constructed. Granting access is a code review event.
 *   2. Every grant carries its justification. An entry without `evidence` gets
 *      no browser mode, ever -- see `evaluatePolicy`.
 *   3. Evidence expires. A permission reviewed 200 days ago is not a current
 *      permission, it is a historical record. See `POLICY_EVIDENCE_MAX_AGE_DAYS`.
 *
 * The third property is the one most agent frameworks skip, and it is the one
 * that matters most in practice: platforms change their terms without warning,
 * and a permission table is a snapshot of what was true when someone read the
 * terms, not a statement about what is true now.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const GLOBAL_EXTERNAL_WRITE_CAP_PER_DAY = 10;
export const CROSS_TARGET_DEDUPE_WINDOW_MS = 7 * DAY_MS;
export const POLICY_EVIDENCE_MAX_AGE_DAYS = 90;

/**
 * Modes are ordered by how much autonomy they grant the agent.
 *
 * `attended_prepare`   - agent may draft, a human performs the action
 * `supervised_browser` - agent may drive a real browser, page JS disabled
 * `manual_only`        - agent may only surface information
 *
 * An agent-supplied task can request a mode. It can never *add* a mode that the
 * local registry did not grant. Escalation has to happen in a reviewed commit.
 */
export const EXECUTION_MODES = Object.freeze([
  "manual_only",
  "attended_prepare",
  "supervised_browser",
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const POLICY_REGISTRY = deepFreeze({
  registry_version: "2026-09-29.v1-public-sample",

  global_external_write_cap_per_day: GLOBAL_EXTERNAL_WRITE_CAP_PER_DAY,
  cross_target_dedupe_window_ms: CROSS_TARGET_DEDUPE_WINDOW_MS,
  policy_evidence_max_age_days: POLICY_EVIDENCE_MAX_AGE_DAYS,

  /**
   * Each entry needs: exact_origins, allowed_actions, allowed_modes, and
   * evidence. `exact_origins: null` means "no origin matches" -- the platform
   * cannot be reached directly until someone adds a specific origin.
   */
  platforms: {
    // A forum whose terms forbid automated reading and posting. The agent may
    // open the URL for the human and stage an exact local draft. It may not
    // navigate, read, click, or submit programmatically.
    community_forum: {
      exact_origins: ["https://forum.example.org"],
      default_mode: "attended_prepare",
      site_daily_cap: 3,
      allowed_actions: ["reply", "edit"],
      allowed_modes: ["attended_prepare", "manual_only"],
      browser_programmatic_access: false,
      target_network_access: false,
      disabled_actions: ["vote", "follow", "direct_message", "account_action"],
      evidence: {
        reviewed_at: "2026-08-14",
        sources: ["https://forum.example.org/terms"],
        quote_summary:
          "Automated access and monitoring are prohibited except a narrow " +
          "public search-indexing exception.",
        consequence:
          "The gate may display the target URL and copy an exact local draft, " +
          "but must not drive the browser at this origin.",
      },
    },

    // A link aggregator that requires comments to be human-authored and not
    // AI-edited. Provenance is enforced in the gate and fails closed.
    news_aggregator: {
      exact_origins: ["https://news.example.com"],
      default_mode: "attended_prepare",
      site_daily_cap: 2,
      allowed_actions: ["comment", "submit_story"],
      allowed_modes: ["attended_prepare", "manual_only"],
      voting: false,
      comment_required_provenance: "human_authored_unedited",
      evidence: {
        reviewed_at: "2026-09-02",
        sources: ["https://news.example.com/guidelines"],
        note:
          "Comments must not be generated or edited by an automated system. " +
          "Provenance is checked before the action is allowed.",
      },
    },

    // A threaded discussion site. Votes and follows are disabled outright even
    // though the agent could technically perform them.
    discussion_site: {
      exact_origins: ["https://talk.example.net"],
      default_mode: "attended_prepare",
      site_daily_cap: 3,
      allowed_actions: ["submit_post", "submit_comment"],
      allowed_modes: ["attended_prepare", "manual_only"],
      supervised_personal_account_browser_write: false,
      disabled_actions: ["vote", "follow", "automated_dm", "account_action"],
      evidence: {
        reviewed_at: "2026-08-27",
        sources: [
          "https://talk.example.net/policies/user-agreement",
          "https://developers.talk.example.net/docs/capabilities",
        ],
        note:
          "Personal-account writes stay off. Official API capabilities remain " +
          "out of scope for this registry version.",
      },
    },

    /**
     * The catch-all. There is no wildcard origin grant: an agent cannot
     * "submit a generic form" anywhere, because "anywhere" is not a boundary
     * anyone reviewed. A specific origin must be added to `domain_policies`
     * below, in a reviewed commit, before that origin becomes reachable.
     */
    generic_form: {
      exact_origins: null,
      default_mode: "attended_prepare",
      site_daily_cap: 3,
      allowed_actions: ["submit"],
      allowed_modes: ["attended_prepare", "manual_only"],
      wildcard_browser_permission: false,
      domain_policies: {
        // Reviewed entry. Note the evidence: without fresh evidence this entry
        // still cannot reach `supervised_browser`.
        "https://forms.example.gov": {
          allowed_modes: ["supervised_browser", "attended_prepare", "manual_only"],
          site_daily_cap: 10,
          evidence: {
            reviewed_at: "2026-09-10",
            sources: ["https://forms.example.gov/robots-and-terms"],
            note:
              "Public form with no authentication and no state-changing GET. " +
              "Reviewed for automated submission on this date.",
          },
        },
      },
      evidence: null,
    },

    /**
     * The only place `supervised_browser` is granted by default, and only for
     * exact-origin loopback HTTP with page JavaScript disabled. This is how the
     * runtime tests itself without ever pointing a real browser at a real site.
     */
    local_fixture: {
      exact_origins: null,
      default_mode: "supervised_browser",
      site_daily_cap: 10,
      allowed_actions: ["read", "submit"],
      allowed_modes: ["supervised_browser", "manual_only"],
      evidence: {
        reviewed_at: "2026-09-20",
        sources: [],
        note:
          "Restricted to exact-origin loopback fixtures served by the test " +
          "harness, with page JavaScript disabled.",
      },
    },
  },
});

/**
 * origin -> platform, so a task cannot claim platform A's permission while
 * actually targeting platform B's origin.
 */
export const KNOWN_ORIGIN_OWNERS = deepFreeze(
  Object.fromEntries(
    Object.entries(POLICY_REGISTRY.platforms).flatMap(([platform, rule]) =>
      (rule.exact_origins ?? []).map((origin) => [origin, platform]),
    ),
  ),
);

export function getPlatformPolicy(platform) {
  return POLICY_REGISTRY.platforms[platform] ?? null;
}

export { deepFreeze, DAY_MS };
