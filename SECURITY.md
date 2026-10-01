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
