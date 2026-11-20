# Agent Policy Core

One of the more expensive words in automation is **“again.”**

An agent may have permission to click Submit. That doesn't mean it should click again when the response disappears. The first click might have worked; the second one might explain why a customer has two identical orders.

This JavaScript library is a policy check for tool-calling agents. It keeps two questions separate: **are you allowed to try?** and **is trying again safe?**

## Permission is not permission to retry

| Evidence | Decision | Reason |
| --- | --- | --- |
| Origin, action, mode, review age, or write cap doesn't match the grant | Deny | Permission has actual boundaries |
| Grant is valid; no earlier effect recorded | Eligible to proceed | The first attempt can be authorized |
| Earlier effect is an unresolved intent | Block duplicate intent | We may already have acted |
| Earlier effect was confirmed | Block duplicate effect | Doing it twice is not an improvement |
| Earlier effect is ambiguous | Stop; verify externally | Unknown isn't the same as failed |

The code checks the exact URL origin, not an address that merely *looks* friendly. An accepted grant can't override a conflicting effect journal. That separation matters when the external result is unknown.

## Where the rules are

[registry.js](src/registry.js) defines reviewed platforms, actions, modes, and limits; [policy.js](src/policy.js) checks admission and scope; [dedupe.js](src/dedupe.js) handles duplicate/unresolved effects; [journal.js](src/journal.js) keeps redacted records. See [tests](test/), [invariants](docs/invariants.md), [failure modes](docs/failure-modes.md), and [verification notes](docs/verification.md). Node.js 20+.

## What isn't included

No Chrome driver, provider client, credentials, deployment, or reliable external-effect observer comes with this library. The caller must wire the gate into its real tool boundary and persist the journal correctly.

The library can tell the caller when a retry is unsafe. A caller that ignores it can still make a mess; no npm package can fix that design decision. [Security](SECURITY.md) · [provenance](PROVENANCE.md).
