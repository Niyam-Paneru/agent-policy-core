# Failure modes

## Stale permission
A grant can outlive the evidence that justified it. Response: narrow or deny once review age expires.

## Origin drift
A capability approved for one origin appears on another. Response: deny; origin matching is part of the policy input.

## Ambiguous side effect
The system recorded intent but cannot prove whether the effect landed. Response: stop and verify instead of replaying.

## Missing or invalid cross-target timing evidence
A broken clock (NaN), malformed configured window or legacy record with an unparseable timestamp can otherwise make every time comparison false, silently allowing a duplicate write. Response: reject invalid clock/window settings and treat a matching record with unreadable time as an ambiguous effect requiring review. Capture the journal snapshot once per check so immutable defensive reads do not create quadratic scanning cost.

## Secret-bearing evidence
A useful log field may contain a credential. Response: redact before persistence, not after.

## Provenance mismatch
Human-authored content is required, but the agent generated the payload itself. Response: deny the irreversible action.

## Authorized action is replayed despite existing effect intent
A combined authorization/idempotency hook that checks only cross-target content can permit an exact same-effect retry even after the ledger recorded intent, confirmation or ambiguous completion. Response: check the supplied `idempotency.effect_key` through `checkEffect` after authorization and before cross-target analysis. An absent effect key cannot be deduplicated by this check; callers still own stable effect identity.

## Effect journal tampering and timestamp spoofing
Returning the private records array lets a caller erase ambiguous effects and bypass replay protection. Caller-controlled event timestamps can also backdate a confirmed effect outside a duplicate-content window. Response: immutable detached record snapshots, defensive collection reads, and clock-owned event timestamps.

## Unknown capability
A new tool or action appears without a reviewed registry entry. Response: default deny.
