# Verification

Requires Node.js 20+ and has no runtime dependencies.

Run the same checks used by CI:

```bash
for file in src/*.js; do node --check "$file"; done
npm test
npm run demo
```

Expected result: each command exits successfully. `npm test` exercises the authorization and effect-state boundaries; `npm run demo` runs the decision walkthrough.

CircleCI also checks that the public boundary documents exist: `docs/invariants.md`, `docs/failure-modes.md`, `docs/verification.md`, `SECURITY.md`, and `PROVENANCE.md`.