# Walkthrough: “just retry it”

An agent has permission to submit a reviewed form on one approved origin.

The request passes:

- capability check;
- exact origin check;
- evidence freshness;
- provenance requirements.

The policy allows the attempt.

Before transport, an effect intent is recorded.

The request is sent, but the network disconnects before a response arrives.

At this point the policy system does **not** know that the form failed. It knows only that the outcome is unresolved.

If the agent asks to retry the same canonical effect, the idempotency layer blocks it.

Why?

Because two successful submissions can be worse than one uncertain submission.

The recovery path is observation first, action second.
