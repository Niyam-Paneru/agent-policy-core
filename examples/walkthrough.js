/**
 * Runnable walkthrough. `npm run demo`
 *
 * Every decision printed below is reproducible by hand. If a line surprises
 * you, the reason string tells you which rule fired.
 */

import { createPolicyEngine } from "../src/policy.js";
import { Journal, redactUrl } from "../src/journal.js";
import { Dedupe } from "../src/dedupe.js";

const now = new Date("2026-09-29T12:00:00Z");
const engine = createPolicyEngine({ now: () => now });

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

function show(label, task, decision = engine(task)) {
  const verdict = decision.allowed
    ? green(`ALLOW  ${decision.effectiveMode}`)
    : red(`DENY   ${decision.reason}`);
  const suffix = decision.allowed
    ? ""
    : decision.effectiveMode
      ? dim(` → fallback: ${decision.effectiveMode}`)
      : "";
  console.log(`  ${label.padEnd(46)} ${verdict}${suffix}`);
}

const task = (over = {}) => ({
  platform: "discussion_site",
  action: "submit_post",
  execution_mode: "attended_prepare",
  target: { url: "https://talk.example.net/r/all", origin: "https://talk.example.net" },
  ...over,
});

console.log(bold("\n1. Default deny\n"));
console.log(dim("   The gate is asked about a site it has never heard of.\n"));
show("unknown platform", task({ platform: "unknown_site" }));
show("action outside allowlist (vote)", task({ action: "vote" }));

console.log(bold("\n2. A task cannot escalate its own permissions\n"));
console.log(dim("   The agent asks for supervised_browser at an origin that\n"));
console.log(dim("   only ever granted attended preparation.\n"));
show("requested supervised_browser", task({ execution_mode: "supervised_browser" }));
show("claimed origin ≠ real origin", task({
  target: { url: "https://elsewhere.example/x", origin: "https://talk.example.net" },
}));
show("credentials in URL", task({
  target: { url: "https://u:p@talk.example.net/x", origin: "https://talk.example.net" },
}));

console.log(bold("\n3. Generic forms have no wildcard\n"));
console.log(dim("   'Any website' is not a boundary anyone reviewed.\n"));
const generic = (origin, mode = "supervised_browser") =>
  task({
    platform: "generic_form",
    action: "submit",
    execution_mode: mode,
    target: { url: `${origin}/x`, origin },
  });
show("unreviewed origin", generic("https://anywhere.example"));
show("reviewed origin", generic("https://forms.example.gov"));

console.log(bold("\n4. Permissions expire\n"));
console.log(dim("   Same reviewed origin, same task, six months later.\n"));
const later = createPolicyEngine({ now: () => new Date("2027-06-01T00:00:00Z") });
show("reviewed origin, 6 months later", generic("https://forms.example.gov"), later(generic("https://forms.example.gov")));

console.log(bold("\n5. Provenance fails closed\n"));
console.log(dim("   One platform requires comments to be human-authored.\n"));
const comment = (content) =>
  task({
    platform: "news_aggregator",
    action: "comment",
    execution_mode: "attended_prepare",
    target: { url: "https://news.example.com/item?id=42", origin: "https://news.example.com" },
    content,
  });
show("no provenance", comment({}));
show("AI-generated", comment({ provenance: { body: "ai_generated" } }));
show("human authored", comment({ provenance: { body: "human_authored_unedited" } }));

console.log(bold("\n6. Uncertain effects are not retried\n"));
console.log(dim("   We do not know whether the write landed. That is a reason\n"));
console.log(dim("   to stop, not a reason to try again.\n"));

const journal = new Journal({ now: () => new Date("2026-09-29T12:00:00Z") });
const dedupe = new Dedupe(journal);

for (const phase of ["effect_intent", "effect_ambiguous", "effect_confirmed"]) {
  journal.append({ effect_key: "task-1", phase, task_id: "task-1" });
  const result = dedupe.checkEffect("task-1");
  console.log(`  ${phase.padEnd(46)} ${red(`BLOCK  ${result.reason}`)}`);
}

console.log(bold("\n7. Credentials never reach the log\n"));
journal.append({
  effect_key: "task-2",
  phase: "effect_intent",
  url: "https://talk.example.net/redirect?token=fake-redact-me&next=/home",
  payload: { authorization: "Bearer fake-redact-me", user_id: 41207 },
});
const [last] = journal.records.slice(-1);
console.log(`  ${"logged url".padEnd(46)} ${dim(last.url)}`);
console.log(`  ${"logged auth header".padEnd(46)} ${dim(String(last.payload.authorization))}`);
console.log(`  ${"logged user id (kept)".padEnd(46)} ${dim(String(last.payload.user_id))}`);
console.log(`  ${"redacted directly".padEnd(46)} ${dim(redactUrl("https://x.example/cb?token=abc&page=2"))}`);

console.log(bold("\n   Every line above is produced by code in this repo.\n"));
