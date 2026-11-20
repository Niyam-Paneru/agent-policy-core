# Agent Policy Core

Giving an AI agent a tool is easy. Convincing it that “you have permission” does **not** mean “keep clicking until something happens” is an entirely different project.

This JavaScript module puts a **policy check** in front of tool-calling agents. It separates two questions that sound similar until you accidentally submit the same form twice:

**Are you allowed to try?** And **is trying again safe?**

## Yes, you may. No, not again.

| Evidence | Decision | Reason |
| --- | --- | --- |
| Origin, action, mode, review age, or write cap doesn't match the grant | Deny | Permission has actual boundaries |
| Grant is valid; no earlier effect recorded | Eligible to proceed | The first attempt can be authorized |
| Earlier effect is an unresolved intent | Block duplicate intent | We may already have acted |
| Earlier effect was confirmed | Block duplicate effect | Doing it twice is not an improvement |
| Earlier effect is ambiguous | Stop; verify externally | Unknown isn't the same as failed |

The code checks the exact URL origin, not an address that merely *looks* friendly. An accepted grant can't override a conflicting effect journal. The ledger isn't being dramatic; it's been burned before.

## Code worth opening

[registry.js](src/registry.js) defines reviewed platforms, actions, modes, and limits; [policy.js](src/policy.js) checks admission and scope; [dedupe.js](src/dedupe.js) handles duplicate/unresolved effects; [journal.js](src/journal.js) keeps redacted records. See [tests](test/), [invariants](docs/invariants.md), [failure modes](docs/failure-modes.md), and [verification notes](docs/verification.md). Node.js 20+.

## No magic browser included

No Chrome driver, provider client, credentials, deployment, or reliable external-effect observer comes with this library. The caller must wire the gate into its real tool boundary and persist the journal correctly.

The module can tell you when a retry is unsafe. It cannot stop a determined developer from placing the call on the wrong side of the gate. [Security](SECURITY.md) · [provenance](PROVENANCE.md).
