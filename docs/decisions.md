# Decisions

## Default deny

Unknown platform, action, origin, or mode is denied. “The model probably knows what I meant” is not a permission source.

## Permission decays

Reviewed evidence has an age. When it gets stale, autonomy narrows instead of silently continuing forever.

## Ambiguous is a first-class outcome

If the system knows it intended an effect but cannot prove whether it landed, a replay is blocked.

## Human provenance matters

Some actions are allowed only when the content came from a person rather than being invented by the agent itself.

## Redact before persistence

Secrets should be removed before they reach the journal. A log-cleanup job after the fact is an apology, not a control.

> If a policy layer can surprise you, it is trying too hard.
