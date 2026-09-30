import test from "node:test";
import assert from "node:assert/strict";

import { createPolicyEngine, evidenceIsStale } from "../src/policy.js";

const NOW = new Date("2026-09-29T12:00:00Z");
const engine = createPolicyEngine({ now: () => NOW });

const task = (over = {}) => ({
  platform: "discussion_site",
  action: "submit_post",
  execution_mode: "attended_prepare",
  target: { url: "https://talk.example.net/r/all", origin: "https://talk.example.net" },
  ...over,
});

test("allows a task that matches the registry exactly", () => {
  const decision = engine(task());
  assert.equal(decision.allowed, true);
  assert.equal(decision.effectiveMode, "attended_prepare");
  assert.equal(decision.targetOrigin, "https://talk.example.net");
});

test("fails closed on an unknown platform", () => {
  const decision = engine(task({ platform: "some_other_site" }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "unsupported_platform");
});

test("fails closed on an action outside the platform's allowlist", () => {
  const decision = engine(task({ action: "vote" }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "unsupported_action");
});

// --- origin laundering -----------------------------------------------------

test("rejects a task that claims one origin and targets another", () => {
  const decision = engine(
    task({
      target: { url: "https://evil.example/steal", origin: "https://talk.example.net" },
    }),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "redirect_outside_allowlist");
});

test("rejects credentials embedded in the URL", () => {
  const decision = engine(
    task({
      target: {
        url: "https://user:pass@talk.example.net/r/all",
        origin: "https://talk.example.net",
      },
    }),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "redirect_outside_allowlist");
});

test("rejects non-HTTPS targets", () => {
  const decision = engine(
    task({ target: { url: "http://talk.example.net/r/all", origin: "http://talk.example.net" } }),
  );
  assert.equal(decision.allowed, false);
});

test("rejects a target origin the platform does not own", () => {
  const decision = engine(
    task({ target: { url: "https://forum.example.org/x", origin: "https://forum.example.org" } }),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "redirect_outside_allowlist");
});

// --- anti-escalation -------------------------------------------------------

test("a task cannot escalate to a mode the registry never granted", () => {
  const decision = engine(task({ execution_mode: "supervised_browser" }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "mode_not_allowed");
  assert.equal(decision.effectiveMode, "attended_prepare");
});

test("generic_form grants no wildcard browser permission", () => {
  const decision = engine(
    task({
      platform: "generic_form",
      action: "submit",
      execution_mode: "supervised_browser",
      target: { url: "https://unreviewed.example/form", origin: "https://unreviewed.example" },
    }),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "mode_not_allowed");
});

test("generic_form grants browser mode only at a reviewed origin", () => {
  const decision = engine(
    task({
      platform: "generic_form",
      action: "submit",
      execution_mode: "supervised_browser",
      target: { url: "https://forms.example.gov/x", origin: "https://forms.example.gov" },
    }),
  );
  assert.equal(decision.allowed, true);
  assert.equal(decision.effectiveMode, "supervised_browser");
});

// --- evidence decay --------------------------------------------------------

test("evidence expires and autonomy drops to the safe mode", () => {
  const staleEngine = createPolicyEngine({
    now: () => new Date("2027-06-01T00:00:00Z"),
  });
  const decision = staleEngine(
    task({
      platform: "generic_form",
      action: "submit",
      execution_mode: "supervised_browser",
      target: { url: "https://forms.example.gov/x", origin: "https://forms.example.gov" },
    }),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "policy_evidence_stale");
  assert.equal(decision.effectiveMode, "attended_prepare");
});

test("a reviewed permission is still usable on the review date", () => {
  const onReviewDay = createPolicyEngine({
    now: () => new Date("2026-09-10T00:00:00Z"),
  });
  assert.equal(
    onReviewDay(
      task({
        platform: "generic_form",
        action: "submit",
        execution_mode: "supervised_browser",
        target: { url: "https://forms.example.gov/x", origin: "https://forms.example.gov" },
      }),
    ).allowed,
    true,
  );
});

test("missing evidence is treated as stale", () => {
  assert.equal(evidenceIsStale(null, NOW), true);
  assert.equal(evidenceIsStale({ reviewed_at: "not-a-date" }, NOW), true);
});

// --- provenance ------------------------------------------------------------

test("a comment without human provenance is refused", () => {
  const base = {
    platform: "news_aggregator",
    action: "comment",
    execution_mode: "attended_prepare",
    target: { url: "https://news.example.com/item?id=42", origin: "https://news.example.com" },
  };
  assert.equal(engine(base).reason, "provenance_blocked");
  assert.equal(engine({ ...base, content: {} }).reason, "provenance_blocked");
  assert.equal(engine({ ...base, content: { provenance: [] } }).reason, "provenance_blocked");
  assert.equal(
    engine({ ...base, content: { provenance: { body: "ai_generated" } } }).reason,
    "provenance_blocked",
  );
  assert.equal(
    engine({ ...base, content: { provenance: { body: "human_authored_unedited" } } }).allowed,
    true,
  );
});

test("an action must match its exact path, not just the origin", () => {
  const wrongPath = engine({
    platform: "news_aggregator",
    action: "comment",
    execution_mode: "attended_prepare",
    target: { url: "https://news.example.com/anything", origin: "https://news.example.com" },
    content: { provenance: { body: "human_authored_unedited" } },
  });
  assert.equal(wrongPath.reason, "redirect_outside_allowlist");
});

// --- caps ------------------------------------------------------------------

test("requested caps are clamped to the local limit, never trusted", () => {
  const decision = engine(task({ write_caps: { requested_site_daily_max: 9999 } }));
  assert.equal(decision.allowed, true);
  assert.equal(decision.siteMax, decision.localSiteMax);

  const global = engine(task({ write_caps: { requested_global_daily_max: 0 } }));
  assert.equal(global.globalMax, 0);

  const nonsense = engine(task({ write_caps: { requested_site_daily_max: -5 } }));
  assert.equal(nonsense.siteMax, 0);
});

// --- loopback fixtures -----------------------------------------------------

test("loopback fixtures allow supervised browser; public origins never do", () => {
  const ok = engine(
    task({
      platform: "local_fixture",
      action: "read",
      execution_mode: "supervised_browser",
      target: { url: "http://127.0.0.1:8787/", origin: "http://127.0.0.1:8787" },
    }),
  );
  assert.equal(ok.allowed, true);

  const escape = engine(
    task({
      platform: "local_fixture",
      action: "read",
      execution_mode: "supervised_browser",
      target: { url: "http://evil.example/", origin: "http://evil.example" },
    }),
  );
  assert.equal(escape.allowed, false);
});

test("the decision is a pure function of task and clock", () => {
  const first = engine(task());
  const second = engine(task());
  assert.deepEqual(first, second);
});
