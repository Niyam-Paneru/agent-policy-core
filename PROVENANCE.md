# Provenance

Agent Policy Core is a transport-agnostic extraction of policy and effect-state patterns used in private browser-control work.

The repository keeps reviewed capability rules, exact-origin/action checks, evidence freshness, permission narrowing, idempotency, ambiguous-effect blocking, cross-target duplicate detection, and redacted append-only records.

It excludes the private browser control plane, local grant store, credentials, machine state, network/browser drivers, and site-specific workflows.

The library can decide and record whether an external action is allowed or safe to repeat. It cannot prove that an external action actually happened unless the caller records that evidence.
