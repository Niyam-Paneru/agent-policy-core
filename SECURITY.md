# Security model

This library is a decision boundary, not a sandbox.

Its guarantees hold only when the caller:

- invokes the policy gate before the external capability;
- maps the real target and requested capability honestly;
- treats denial and narrowed modes as binding;
- records effect intent before an external write;
- preserves ambiguous outcomes instead of blindly retrying;
- persists the append-only journal in an appropriate store.

Sensitive values are redacted when journal records are written, but this library does not provide network isolation, credential storage, browser isolation, or provider authentication. Those remain responsibilities of the system that embeds it.

## In-process journal integrity

`Journal.records` returns an immutable snapshot; nested record metadata is copied
and frozen on append and JSONL import. `append()` assigns its own timestamp after
processing input fields. These protections prevent ordinary callers from
rewriting in-memory audit evidence through public object references.

This does **not** make exported JSONL cryptographically tamper-evident, durable
across crashes, or safe against a malicious process with access to the store.
The embedding application must protect persisted records and verify their
provenance independently.
