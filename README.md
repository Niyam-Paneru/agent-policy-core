# Agent Policy Core

Somewhere in automation there is an agent that has permission to click Submit and interprets that as a personal invitation to click it forever.

I would prefer not to meet that agent in production.

This JavaScript library checks the terms of the permission **and** whether the requested effect might already exist. “You may use the tool” is not the same as “you may reenact the same write until the server applauds.”

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
