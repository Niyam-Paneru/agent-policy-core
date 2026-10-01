# Failure modes

## Stale permission
A grant can outlive the evidence that justified it. Response: narrow or deny once review age expires.

## Origin drift
A capability approved for one origin appears on another. Response: deny; origin matching is part of the policy input.

## Ambiguous side effect
The system recorded intent but cannot prove whether the effect landed. Response: stop and verify instead of replaying.

## Secret-bearing evidence
A useful log field may contain a credential. Response: redact before persistence, not after.

## Provenance mismatch
Human-authored content is required, but the agent generated the payload itself. Response: deny the irreversible action.

## Unknown capability
A new tool or action appears without a reviewed registry entry. Response: default deny.
