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

test("caller timestamps cannot backdate a confirmed effect past cross-target dedupe", () => {
  const journal = new Journal(at("2026-09-29T10:00:00Z"));
  const record = journal.append({
    timestamp: "1990-01-01T00:00:00Z",
    effect_key: "e1",
    phase: "effect_confirmed",
    cross_target_content_key: "post-42",
    target_fingerprint: "site-a",
  });

  assert.equal(record.timestamp, "2026-09-29T10:00:00.000Z");
  assert.equal(
    new Dedupe(journal).checkCrossTarget({
      contentKey: "post-42",
      targetFingerprint: "site-b",
      windowMs: 7 * 24 * 60 * 60 * 1000,
      now: Date.parse("2026-09-29T11:00:00Z"),
    }).blocked,
    true,
  );
});

test("a caller cannot erase or rewrite append-only effect evidence", () => {
  const journal = new Journal(at("2026-09-29T10:00:00Z"));
  const metadata = { label: "initial" };
  const payload = { nested: { keep: "original", authorization: "secret" } };
  const record = journal.append({
    effect_key: "e1",
    phase: "effect_ambiguous",
    metadata,
    payload,
  });

  journal.records.pop(); // mutates a snapshot, not the private ledger
  metadata.label = "rewritten"; // must not mutate stored evidence
  payload.nested.keep = "rewritten";
  assert.equal(journal.records.length, 1);
  assert.equal(journal.records[0].metadata.label, "initial");
  assert.equal(journal.records[0].payload.nested.keep, "original");
  assert.equal(journal.records[0].payload.nested.authorization, "[REDACTED]");
  assert.equal(new Dedupe(journal).checkEffect("e1").reason, "ambiguous_side_effect");
  assert.equal(Object.isFrozen(record.metadata), true);
  assert.equal(Object.isFrozen(record.payload.nested), true);
  assert.throws(() => { record.payload.nested.keep = "tampered"; }, TypeError);
});

test("restored JSONL records are immutable after rehydration", () => {
  const journal = new Journal(at("2026-09-29T10:00:00Z"));
  journal.append({ effect_key: "e1", phase: "effect_intent", payload: { nested: { count: 1 } } });
  const restored = Journal.fromJSONL(journal.toJSONL(), at("2026-09-29T11:00:00Z"));
  const record = restored.records[0];
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.payload.nested), true);
  assert.throws(() => { record.payload.nested.count = 99; }, TypeError);
  assert.equal(new Dedupe(restored).checkEffect("e1").reason, "duplicate_intent");
});

test("combined policy hook refuses same-effect replays for every effect phase", () => {
  const cases = [
    ["effect_intent", "duplicate_intent"],
    ["effect_confirmed", "duplicate_effect"],
    ["effect_ambiguous", "ambiguous_side_effect"],
  ];

  for (const [phase, reason] of cases) {
    const journal = new Journal(at("2026-09-29T10:00:00Z"));
    journal.append({ effect_key: "effect-1", phase });
    const hook = createPolicyHook({
      dedupe: new Dedupe(journal),
      policyEngine: () => ({ allowed: true, effectiveMode: "attended_prepare" }),
    });

    const replay = hook({ idempotency: { effect_key: "effect-1" } });
    assert.equal(replay.allowed, false, phase);
    assert.equal(replay.reason, reason);
    assert.equal(journal.records.length, 1, "policy hook must not append side effects");

    const fresh = hook({ idempotency: { effect_key: "effect-2" } });
    assert.equal(fresh.allowed, true);
  }
});

test("combined hook keeps authorization denial ahead of replay checks", () => {
  const journal = new Journal(at("2026-09-29T10:00:00Z"));
  journal.append({ effect_key: "effect-1", phase: "effect_confirmed" });
  const hook = createPolicyHook({
    dedupe: new Dedupe(journal),
    policyEngine: () => ({ allowed: false, reason: "unsupported_action" }),
  });
  const refused = hook({ idempotency: { effect_key: "effect-1" } });
  assert.deepEqual(refused, { allowed: false, reason: "unsupported_action" });
});

test("journal redacts sensitive top-level and metadata fields before JSONL persistence", () => {
  const journal = new Journal(at("2026-09-29T10:00:00Z"));
  const record = journal.append({
    effect_key: "effect-123",
    phase: "effect_intent",
    api_key: "synthetic-top-level-key",
    metadata: {
      token: "synthetic-nested-key",
      evidence: "public-evidence",
    },
  });

  assert.equal(record.api_key, "[REDACTED]");
  assert.equal(record.metadata.token, "[REDACTED]");
  assert.equal(record.metadata.evidence, "public-evidence");
  const persisted = journal.toJSONL();
  assert.equal(persisted.includes("synthetic-top-level-key"), false);
  assert.equal(persisted.includes("synthetic-nested-key"), false);
  assert.equal(new Dedupe(journal).checkEffect("effect-123").reason, "duplicate_intent");
});

test("invalid cross-target clock and window cannot bypass effect history", () => {
  const journal = new Journal(at("2026-09-29T10:00:00Z"));
  journal.append({
    phase: "effect_confirmed",
    effect_key: "effect-1",
    cross_target_content_key: "content-1",
    target_fingerprint: "site-a",
  });
  const dedupe = new Dedupe(journal);
  const base = {
    contentKey: "content-1",
    targetFingerprint: "site-b",
    windowMs: 60000,
    now: Date.parse("2026-09-29T10:00:10Z"),
  };

  for (const badWindow of [NaN, Infinity, -Infinity, undefined, "60000"]) {
    const decision = dedupe.checkCrossTarget({ ...base, windowMs: badWindow });
    assert.equal(decision.blocked, true, String(badWindow));
    assert.equal(decision.reason, "invalid_dedupe_window_or_clock");
  }
  for (const badNow of [NaN, Infinity, -Infinity, null, "now"]) {
    const decision = dedupe.checkCrossTarget({ ...base, now: badNow });
    assert.equal(decision.blocked, true, String(badNow));
    assert.equal(decision.reason, "invalid_dedupe_window_or_clock");
  }
  assert.equal(dedupe.checkCrossTarget({ ...base }).reason, "duplicate_content_cross_target");
  assert.equal(dedupe.checkCrossTarget({ ...base, windowMs: 0 }).blocked, false);
});

test("invalid timestamp on prior cross-target effect is ambiguous, not absent", () => {
  const row = JSON.stringify({
    effect_key: "effect-1",
    phase: "effect_ambiguous",
    cross_target_content_key: "content-1",
    target_fingerprint: "site-a",
    timestamp: "not-a-date",
  });
  const journal = Journal.fromJSONL(row + "\n");
  const decision = new Dedupe(journal).checkCrossTarget({
    contentKey: "content-1",
    targetFingerprint: "site-b",
    windowMs: 60000,
    now: Date.parse("2026-09-29T10:00:10Z"),
  });
  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, "ambiguous_side_effect");
  assert.equal(decision.record.effect_key, "effect-1");
});

test("cross-target dedupe traverses an immutable journal snapshot once", () => {
  const journal = new Journal(at("2026-09-29T10:00:00Z"));
  journal.append({
    effect_key: "effect-1",
    phase: "effect_confirmed",
    cross_target_content_key: "content-1",
    target_fingerprint: "site-a",
  });
  journal.append({
    effect_key: "effect-2",
    phase: "effect_confirmed",
    cross_target_content_key: "content-other",
    target_fingerprint: "site-a",
  });
  let reads = 0;
  const once = {
    get records() {
      reads += 1;
      return journal.records;
    },
  };
  const decision = new Dedupe(once).checkCrossTarget({
    contentKey: "content-1",
    targetFingerprint: "site-b",
    windowMs: 60000,
    now: Date.parse("2026-09-29T10:00:10Z"),
  });
  assert.equal(decision.blocked, true);
  assert.equal(reads, 1);
});

test("unknown or missing later effect phase cannot clear an earlier confirmed effect", () => {
  for (const phase of ["unrecognized", undefined, null]) {
    const journal = new Journal(at("2026-09-29T10:00:00Z"));
    journal.append({ effect_key: "effect-7", phase: "effect_confirmed" });
    journal.append({ effect_key: "effect-7", ...(phase === undefined ? {} : { phase }) });
    const dedupe = new Dedupe(journal);
    const blocked = dedupe.checkEffect("effect-7");
    assert.equal(blocked.blocked, true, String(phase));
    assert.equal(blocked.reason, "ambiguous_side_effect");
    const hook = createPolicyHook({
      dedupe,
      policyEngine: () => ({ allowed: true, effectiveMode: "attended_prepare" }),
    });
    const decision = hook({ idempotency: { effect_key: "effect-7" } });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "ambiguous_side_effect");
  }
});

test("unknown phase in restored legacy journal never authorizes replay", () => {
  const journal = Journal.fromJSONL(
    JSON.stringify({ effect_key: "legacy-write", phase: "future_effect_phase" }) + "\n"
  );
  const decision = new Dedupe(journal).checkEffect("legacy-write");
  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, "ambiguous_side_effect");
  assert.equal(new Dedupe(journal).checkEffect("unknown-key").blocked, false);
});
