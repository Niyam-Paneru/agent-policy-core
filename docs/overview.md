# Design overview

Tool-calling agents are easy to demo because happy paths are friendly.

The harder question is: **what happens when the agent is wrong about permission, target, freshness, or whether a side effect already happened?**

This repository isolates four controls:

- `registry.js` — reviewed capability grants and evidence;
- `policy.js` — pure allow/deny evaluation;
- `dedupe.js` — duplicate and ambiguous-effect blocking;
- `journal.js` — append-only evidence with redaction.

The evaluator can narrow permission, never widen it. The idempotency layer treats uncertainty as a reason to stop. The journal records the decision without becoming a secret landfill.

The full private systems that inspired this module contain browser and research tooling. Those transports are intentionally out of scope here.
