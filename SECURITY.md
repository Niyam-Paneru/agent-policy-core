# Security model

This library is a policy proof, not a sandbox.

It assumes the caller:

- invokes the gate before any external tool;
- maps real capabilities to the registry honestly;
- treats deny results as final for that attempt;
- persists the append-only journal somewhere appropriate;
- keeps secret-bearing values out of unreviewed fields.

The module deliberately has no network, browser, credential store, or provider integration.
