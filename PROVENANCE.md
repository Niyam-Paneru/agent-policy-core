# Provenance

This public repository is a reviewable policy slice derived from patterns used in my private Browser Bridge work.

## Preserved

- explicit capability grants;
- origin/action scoping;
- expiring review evidence;
- effect idempotency and ambiguous-state blocking;
- audit-oriented redaction.

## Rewritten for public review

The public code is smaller and transport-agnostic. It does not expose the private browser control plane, local grants, machine state, or site-specific workflows.

## Claim boundary

This repo demonstrates the policy semantics. It does not claim a browser action happened, a target site was automated, or a private deployment is currently running.
