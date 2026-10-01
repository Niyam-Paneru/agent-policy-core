# agent-policy-core

**A deny-by-default policy gate for tool-calling agents.**\n\n**Because “the agent felt like it” is not an authorization model.**

Give an agent the ability to act on the web and the hard question is not "what
should it do?" It is **"what is it allowed to do, and how do you prove it never
did anything else?"** This is that gate: a pure function that decides, before
any tool runs, whether a task is permitted — and an append-only ledger that
records the decision.

The idea in one line: **the refusal is the feature, and permissions expire.**

```text\ntask -> policy gate -> idempotency -> tool -> ledger\n          |              |\n          +-> DENY       +-> AMBIGUOUS? STOP\n```

```bash
git clone <this repo> && cd agent-policy-core
npm test          # 28 tests, no dependencies
npm run demo      # the walkthrough below, live
```

No dependencies. No API keys. No network. Node 20+.

---

## Why this exists

Agent frameworks are good at deciding *how* to call a tool and bad at deciding
*whether* they may. Three failure modes repeat:

1. **Capability creep.** A helper that can "fill a form" can fill any form.
   There is no boundary, so there is nothing to review.
2. **Retry storms.** A request times out. The framework retries. The first one
   actually landed. Now it exists twice, and nobody knows which.
3. **Permissions that outlive their justification.** A site changed its terms
   eight months ago. The allowlist still says yes, because nobody revisited it.

Each of these is a bug that only shows up in production, usually as someone
else's problem.

## What it does

```
task ──▶ policy gate ──▶ idempotency ──▶ (tool) ──▶ ledger
            │                 │
            │                 └─ blocks duplicate / ambiguous / cross-target
            └─ denies unknown platform, unreviewed origin,
               requested-but-ungranted mode, expired evidence,
               non-human provenance
```

| File | Role |
|---|---|
| `src/registry.js` | The permission table. Deep-frozen. Every grant carries the source that justified it. |
| `src/policy.js` | The evaluator. Pure function of `(task, now)`. No I/O, so it is exhaustively testable. |
| `src/journal.js` | Append-only ledger. Redacts on write, so secrets never reach storage. |
| `src/dedupe.js` | Idempotency. Blocks retries, ambiguous outcomes, and cross-target reposts. |

## The walkthrough

`npm run demo` prints this, live:

```
1. Default deny
  unknown platform                              DENY   unsupported_platform
  action outside allowlist (vote)               DENY   unsupported_action

2. A task cannot escalate its own permissions
  requested supervised_browser                  DENY   mode_not_allowed → fallback: attended_prepare
  claimed origin ≠ real origin                  DENY   redirect_outside_allowlist
  credentials in URL                            DENY   redirect_outside_allowlist

3. Generic forms have no wildcard
  unreviewed origin                             DENY   mode_not_allowed → fallback: attended_prepare
  reviewed origin                               ALLOW  supervised_browser

4. Permissions expire
  reviewed origin, 6 months later               DENY   policy_evidence_stale → fallback: attended_prepare

5. Provenance fails closed
  no provenance                                 DENY   provenance_blocked
  AI-generated                                  DENY   provenance_blocked
  human authored                                ALLOW  attended_prepare

6. Uncertain effects are not retried
  effect_intent                                 BLOCK  duplicate_intent
  effect_ambiguous                              BLOCK  ambiguous_side_effect
  effect_confirmed                              BLOCK  duplicate_effect

7. Credentials never reach the log
  logged url   https://talk.example.net/redirect?token=%5BREDACTED%5D&next=%2Fhome
  logged auth  [REDACTED]
```

## Four properties worth reading the code for

**1. The gate can only narrow, never widen.**

There is no code path where evaluating a task returns more permission than the
registry already contains. A task may *request* a mode; it cannot *add* one:

```js
if (!rule.allowed_modes.includes(requestedMode)) return { allowed: false, reason: "mode_not_allowed" };
```

Escalation has to happen in a reviewed commit that edits the frozen registry.
That is the whole security model: **the agent cannot widen its own sandbox at
runtime, no matter what it claims.**

**2. Evidence expires. Autonomy decays automatically.**

Every permission records `reviewed_at` and the sources behind it. After 90 days
the grant still permits safe preparation but stops permitting automated
control. Nobody has to remember to re-review — the permission quietly downgrades
instead of quietly continuing.

This is the property most agent frameworks skip, and it is the one that matters
in practice: platforms change terms without warning, and an allowlist is a
snapshot of what someone read once.

**3. `effect_ambiguous` is a block, not a retry.**

Three phases hard-block a repeated effect: `effect_intent` (we said we would),
`effect_confirmed` (we know it worked), and `effect_ambiguous` (we do not know).

The third is the point. Systems that only block on confirmed success retry
requests whose outcome they never learned — and that is how the same post goes
out twice. **Uncertainty is treated as a positive reason to stop.**

**4. `generic_form` has no wildcard.**

There is no "submit a form anywhere" permission, because "anywhere" is not a
boundary a person reviewed. A specific origin has to be added to
`domain_policies` in a reviewed commit before that origin is reachable at all.

## Why the ledger is append-only

Records are never edited or deleted. A record that turns out to be wrong is
superseded by a later one. That is what makes the log usable as evidence: every
state the system was in is still there, and a decision can be replayed against
the registry version that produced it.

Redaction happens **on write**, not on read. A credential never reaches storage,
so it cannot leak through a log export, a backup, or a bug report.

## Limitations

Stated plainly, because a gate that oversells itself is worse than no gate:

- **The registry is a snapshot.** It encodes what was true on `reviewed_at`. It
  does not fetch terms, and it cannot know about a policy change. Expiry bounds
  the damage; it does not prevent it.
- **In-memory only.** `Journal` lives in a process. Real durability means
  appending to a file or stream with fsync — the interface is designed for it,
  but it is not implemented here.
- **Origin checks are not DNS pinning.** A verified origin can still resolve to
  an attacker-controlled address. Mitigating that needs network-layer pinning,
  which belongs to the runtime, not this module.
- **No defence against a compromised registry.** The registry is trusted input.
  Keeping it frozen prevents *runtime* tampering, not *build-time* tampering.
- **Policy decides; it does not enforce.** This returns a decision. Something
  else has to act on it. The value is that the decision is auditable.

## Provenance

This is a **sanitised standalone extraction** of policy, idempotency, and
ledger behaviour from the private Browser Bridge project, a local browser-control
system. Platform names, origin allowlists, and integration details are
illustrative and non-functional. The public module preserves the reviewed policy
and expiry rules, ambiguous-effect blocking, and write-time redaction while
removing project-specific transport and browser code.

The full Browser Bridge system is not public.

## If you take one thing

Make capability explicit and make it expire. A tool the agent "can use" is a
tool it will eventually use at the wrong moment.
