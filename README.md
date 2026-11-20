# Agent Policy Core

Giving an agent a key to one room doesn't give it permission to move into the entire building. Apparently, that needs to be written down in code, too.

This JavaScript library checks the grant for the requested action and separately checks whether the effect may already exist. A valid permission doesn't make an unresolved write safe to repeat.

## Permission has an expiry date. So does my patience.

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

The library can refuse a risky retry. It cannot stop you from wiring it in *after* the real tool call, where it would be a beautifully tested decoration. [Security](SECURITY.md) · [provenance](PROVENANCE.md).
