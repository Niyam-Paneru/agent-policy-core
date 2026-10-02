# Agent Policy Core

A deny-by-default policy gate for tool-calling agents. It keeps **authorization** separate from **effect-state/idempotency**, so a request can be permitted and still be blocked from replay.

*Sometimes the correct tool call is no tool call.*

## Authorization narrows; never widens

```mermaid
flowchart TD
    A["request"] --> B{"platform + action reviewed?"}
    B -- no --> D["DENY<br/>unsupported platform/action"]
    B -- yes --> C{"exact target valid?"}
    C -- no --> E["DENY<br/>redirect_outside_allowlist"]
    C -- yes --> P{"provenance okay?<br/>(when required)"}
    P -- no --> Q["DENY<br/>provenance_blocked"]
    P -- yes --> M{"requested mode granted?"}
    M -- no --> N["DENY mode_not_allowed<br/>return safer effectiveMode"]
    M -- yes --> F{"policy evidence fresh?"}
    F -- yes --> G["ALLOW<br/>clamp requested write caps"]
    F -- no --> S{"requested mode is a safe fallback?"}
    S -- yes --> H["ALLOW<br/>attended_prepare / manual_only"]
    S -- no --> I["DENY policy_evidence_stale<br/>narrow effectiveMode"]
```

`src/policy.js` evaluates the reviewed registry, target, mode, evidence freshness, and required provenance. The mode check runs before the freshness check so a permanently ungranted mode is not misreported as a temporary stale-evidence problem.

## Effect state is a separate decision

```mermaid
flowchart LR
    A["authorization allowed"] --> B["check effect key"]
    B --> C{"latest effect phase?"}
    C -- none --> D["eligible to proceed"]
    C -- effect_intent --> E["BLOCK<br/>duplicate_intent"]
    C -- effect_confirmed --> F["BLOCK<br/>duplicate_effect"]
    C -- effect_ambiguous --> G["BLOCK<br/>ambiguous_side_effect"]
    G --> H["stop + verify<br/>do not replay"]
```

`src/dedupe.js` treats intent, confirmed effects, and ambiguous effects as hard stops. `createPolicyHook()` can also block confirmed or ambiguous reuse of the same content across different targets inside the configured dedupe window.

## Code to inspect first

| File | Responsibility |
|---|---|
| [`src/registry.js`](src/registry.js) | reviewed grants, modes, limits, and evidence |
| [`src/policy.js`](src/policy.js) | pure authorization decision and narrowing |
| [`src/dedupe.js`](src/dedupe.js) | duplicate, cross-target, and ambiguous-effect blocking |
| [`src/journal.js`](src/journal.js) | append-only effect evidence with redaction |
| [`test/policy.test.js`](test/policy.test.js) | authorization boundary tests |
| [`test/dedupe.test.js`](test/dedupe.test.js) | effect-state/idempotency tests |
| [`examples/walkthrough.js`](examples/walkthrough.js) | decision walkthrough |

## Evidence and boundaries

CircleCI is configured to check source syntax, behavior tests, the walkthrough, and required public docs. Exact local commands and expected checks: [docs/verification.md](docs/verification.md).

This is a policy library, not a sandbox or browser driver. It has no network client, browser integration, credential store, or provider SDK. The caller must invoke the gate before external tools and persist/use the journal appropriately.

See [SECURITY.md](SECURITY.md), [PROVENANCE.md](PROVENANCE.md), [docs/invariants.md](docs/invariants.md), and [docs/failure-modes.md](docs/failure-modes.md) for the assumptions and failure contract.