# Agent Policy Core

**A deny-by-default policy gate for tool-calling agents.**

**Because “the agent felt like it” is not an authorization model.**

![Policy workflow](docs/workflow.svg)

This repo is about the awkward part of agent systems: not *how* to call a tool, but **whether the tool call should exist at all**.

## What it protects against

- capability creep;
- stale permissions;
- unreviewed origins;
- agent-generated content pretending to have human authority;
- retrying a side effect whose outcome is unknown;
- secrets leaking into the audit trail.

The core is intentionally small and split by responsibility:

| File | Responsibility |
|---|---|
| `registry.js` | reviewed grants + evidence |
| `policy.js` | pure allow / deny decision |
| `dedupe.js` | duplicate and ambiguous-effect blocking |
| `journal.js` | append-only evidence with redaction |

## The part I care about most

Most systems understand:

- **confirmed failure** → retry;
- **confirmed success** → do not retry.

The dangerous state is the third one:

- **we do not know whether the effect happened**.

This repo treats that as **stop and verify**, not “eh, send it again.”

That matters for forms, posts, messages, purchases, and anything else where two successes are worse than one failure.

## Permission is not forever

Every grant has evidence and review time. When the evidence goes stale, the system narrows what it will do.

An allowlist should describe a reviewed boundary, not an archaeological artifact nobody is brave enough to delete.

## Repo map

- `src/` — policy, registry, dedupe, journal;
- `test/` — policy and effect-state behavior;
- `examples/` — small walkthrough;
- `docs/overview.md` — architecture in words;
- `docs/decisions.md` — why the controls exist;
- `docs/workflow.svg` — the decision path;
- `SECURITY.md` — assumptions and boundary.

The package has no network, no browser, no credential store, and no provider SDK. Those belong outside the policy core.

Want to poke holes in it? Read the [invariants](docs/invariants.md), [failure modes](docs/failure-modes.md), [decision table](docs/decision-table.md), and [walkthrough](docs/walkthrough.md).

> The refusal is not an error message. Sometimes it is the feature.
