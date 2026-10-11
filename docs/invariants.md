# Invariants

These are the rules the implementation is not allowed to “optimize away.”

1. **Unknown capability → deny.** A new tool, origin, or action does not inherit permission from something similar.
2. **Stale evidence never widens authority.** Expired review can narrow a grant or deny it; it cannot create new autonomy.
3. **Ambiguous effect → no automatic replay.** Once intent exists without confirmed outcome, the next step is verification.
4. **Human provenance cannot be forged by the agent.** If a capability requires human-authored content, generated text does not satisfy it.
5. **Secrets are redacted before persistence.** Top-level fields, nested metadata, and payload data are sanitized before JSONL storage; the audit trail should not become a credential archive.
6. **Policy runs before transport.** A tool call is not created first and justified later.
7. **The effect journal cannot be rewritten through public references.** Caller-provided timestamps cannot backdate events, and both new and restored records have immutable, detached snapshots.

The public tests cover the decision boundary. Provider/browser integrations belong outside this core.
