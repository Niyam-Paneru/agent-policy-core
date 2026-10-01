import test from "node:test";
import assert from "node:assert/strict";

import { Journal, redactUrl, redactValue } from "../src/journal.js";
import { Dedupe } from "../src/dedupe.js";
import { createPolicyHook, createPolicyEngine } from "../src/policy.js";

const at = (iso) => ({ now: () => new Date(iso) });

test("credentials are redacted on write, never on read", () => {
  const journal = new Journal(at("2026-09-29T10:00:00Z"));
  journal.append({
    effect_key: "e1",
    phase: "effect_intent",
    payload: {
      note: "hello",
      authorization: "Bearer fake-redact-me",
      nested: { api_key: "xyz", password: "hunter2", keep: "visible" },
    },
  });

  const [record] = journal.records;
  assert.equal(record.payload.note, "hello");
  assert.equal(record.payload.authorization, "[REDACTED]");
  assert.equal(record.payload.nested.api_key, "[REDACTED]");
  assert.equal(record.payload.nested.password, "[REDACTED]");
  assert.equal(record.payload.nested.keep, "visible");
});

test("sensitive query parameters are stripped from logged URLs", () => {
  assert.equal(
    redactUrl("https://x.example/cb?token=abc123&page=2"),
    "https://x.example/cb?token=%5BREDACTED%5D&page=2",
  );
  assert.equal(redactUrl("not a url"), "[INVALID_URL]");
});

test("the ledger is append-only and round-trips through JSONL", () => {
  const journal = new Journal(at("2026-09-29T10:00:00Z"));
  journal.append({ effect_key: "e1", phase: "effect_intent" });
  journal.append({ effect_key: "e1", phase: "effect_confirmed" });

  const restored = Journal.fromJSONL(journal.toJSONL(), at("2026-09-29T10:00:00Z"));
  assert.equal(restored.records.length, 2);
  assert.equal(restored.records[0].phase, "effect_intent");
  assert.equal(restored.getEffectLatest("e1").phase, "effect_confirmed");
});

test("a confirmed effect blocks a retry", () => {
  const journal = new Journal(at("2026-09-29T10:00:00Z"));
  const dedupe = new Dedupe(journal);

  journal.append({ effect_key: "e1", phase: "effect_confirmed" });
  const result = dedupe.checkEffect("e1");

  assert.equal(result.blocked, true);
  assert.equal(result.reason, "duplicate_effect");
});

test("an announced intent blocks before the outcome is known", () => {
  const journal = new Journal(at("2026-09-29T10:00:00Z"));
  const dedupe = new Dedupe(journal);

  journal.append({ effect_key: "e1", phase: "effect_intent" });
  const result = dedupe.checkEffect("e1");

  assert.equal(result.blocked, true);
  assert.equal(result.reason, "duplicate_intent");
});

test("an ambiguous effect blocks, because uncertainty is not permission to retry", () => {
  const journal = new Journal(at("2026-09-29T10:00:00Z"));
  const dedupe = new Dedupe(journal);

  journal.append({ effect_key: "e1", phase: "effect_ambiguous" });
  const result = dedupe.checkEffect("e1");

  assert.equal(result.blocked, true);
  assert.equal(result.reason, "ambiguous_side_effect");
});

test("an unknown effect key is allowed through", () => {
  const journal = new Journal();
  assert.equal(new Dedupe(journal).checkEffect("never-seen").blocked, false);
});

test("the same content cannot be posted to a different target inside the window", () => {
  const journal = new Journal(at("2026-09-29T10:00:00Z"));
  const dedupe = new Dedupe(journal);

  journal.append({
    effect_key: "e1",
    phase: "effect_confirmed",
    cross_target_content_key: "post-42",
    target_fingerprint: "site-a",
  });

  const cross = dedupe.checkCrossTarget({
    contentKey: "post-42",
    targetFingerprint: "site-b",
    windowMs: 7 * 24 * 60 * 60 * 1000,
    now: Date.parse("2026-09-29T11:00:00Z"),
  });
  assert.equal(cross.blocked, true);
  assert.equal(cross.reason, "duplicate_content_cross_target");

  const sameTarget = dedupe.checkCrossTarget({
    contentKey: "post-42",
    targetFingerprint: "site-a",
    windowMs: 7 * 24 * 60 * 60 * 1000,
    now: Date.parse("2026-09-29T11:00:00Z"),
  });
  assert.equal(sameTarget.blocked, false, "same target is handled by checkEffect");

  const afterWindow = dedupe.checkCrossTarget({
    contentKey: "post-42",
    targetFingerprint: "site-b",
    windowMs: 1000,
    now: Date.parse("2026-09-29T11:00:01Z"),
  });
  assert.equal(afterWindow.blocked, false);
});

test("a terminal task status blocks resubmission", () => {
  const journal = new Journal(at("2026-09-29T10:00:00Z"));
  const dedupe = new Dedupe(journal);

  journal.append({ task_id: "t1", task_status: "needs_review" });
  assert.equal(dedupe.checkTask("t1").blocked, true);

  const fresh = new Journal();
  assert.equal(new Dedupe(fresh).checkTask("t2").blocked, false);
});

test("the policy hook checks idempotency only after policy allows the task", () => {
  const journal = new Journal(at("2026-09-29T10:00:00Z"));
  const dedupe = new Dedupe(journal);

  const engine = createPolicyEngine({ now: () => new Date("2026-09-29T12:00:00Z") });
  const hook = createPolicyHook({
    dedupe,
    policyEngine: engine,
    now: () => Date.parse("2026-09-29T12:00:00Z"),
  });

  journal.append({
    effect_key: "e1",
    phase: "effect_confirmed",
    cross_target_content_key: "post-42",
    target_fingerprint: "site-a",
  });

  // Refused by policy: the ledger must not record this as an effect.
  const refused = hook({
    platform: "community_forum",
    action: "vote",
    execution_mode: "attended_prepare",
    target: { url: "https://forum.example.org/x", origin: "https://forum.example.org" },
  });
  assert.equal(refused.allowed, false);
  assert.equal(refused.reason, "unsupported_action");
  assert.equal(journal.records.length, 1, "no record written for a policy refusal");

  // Allowed by policy, blocked by idempotency.
  const blocked = hook({
    platform: "community_forum",
    action: "reply",
    execution_mode: "attended_prepare",
    target: { url: "https://forum.example.org/x", origin: "https://forum.example.org" },
    idempotency: { cross_target_content_key: "post-42" },
    target_fingerprint: "forum.example.org",
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "duplicate_content_cross_target");
});
