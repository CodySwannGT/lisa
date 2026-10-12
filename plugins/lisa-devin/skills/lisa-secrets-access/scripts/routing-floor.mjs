/**
 * Derive the credentials a project's vendor routing already implies.
 *
 * `.lisa.config.json` declares `tracker` and `source` — which tracker receives
 * ticket writes, which system hosts PRDs. Those two lines already determine a
 * set of credentials without which nothing works: `tracker: "github"` cannot
 * write an issue without `GH_TOKEN`, `source: "notion"` cannot read a PRD
 * without `NOTION_API_TOKEN`.
 *
 * Until now that mapping lived only in prose, in `config-resolution.md`'s
 * invariants, with nothing connecting it to `secrets.require`. So the two could
 * drift silently and adding a vendor never added its credential to the asserted
 * set — the list was hand-maintained when most of it was deducible.
 *
 * This module is that deduction, as code. The floor is *unioned* into the
 * required set at resolution time rather than checked against a hand-written
 * list, because correctness should not depend on someone having remembered to
 * type `GH_TOKEN` into a file. A project still declares its extras — an
 * `ATTIO_API_KEY` no routing can imply — in `secrets.require`.
 *
 * Deliberately not exhaustive about *optional* integrations. A credential
 * appears here only when the routing that implies it makes the project
 * non-functional without it. Sonar, Sentry and PostHog are configured
 * separately and a project runs fine with none of them, so they are extras a
 * project declares, not a floor anything derives.
 * @module routing-floor
 */

/**
 * The credential each destination tracker cannot operate without.
 *
 * Confluence and JIRA share `ATLASSIAN_API_TOKEN` because they are one vendor
 * behind one token — the same reason `lisa-atlassian-access` serves both.
 */
const TRACKER_CREDENTIALS = {
  jira: ["ATLASSIAN_API_TOKEN"],
  github: ["GH_TOKEN"],
  linear: ["LINEAR_API_KEY"],
};

/** The credential each PRD source cannot be read without. */
const SOURCE_CREDENTIALS = {
  notion: ["NOTION_API_TOKEN"],
  confluence: ["ATLASSIAN_API_TOKEN"],
  jira: ["ATLASSIAN_API_TOKEN"],
  github: ["GH_TOKEN"],
  linear: ["LINEAR_API_KEY"],
};

/**
 * The credentials a project's routing makes mandatory.
 *
 * An unknown or absent vendor contributes nothing rather than throwing. This
 * function answers "what does routing imply", and a `tracker` Lisa does not
 * recognise is a *routing* error that `config-resolution`'s dispatch already
 * reports with a better message than a credential check could. Failing here
 * too would report the same defect twice, in the wrong vocabulary, and would
 * make a preflight the place a typo in `tracker` first surfaces.
 * @param {{tracker?: string, source?: string}} [routing] Vendor routing.
 * @returns {readonly string[]} Sorted, de-duplicated credential names.
 */
export function routingFloor(routing = {}) {
  const tracker = normalize(routing.tracker);
  const source = normalize(routing.source);
  const names = [
    ...credentialsFor(TRACKER_CREDENTIALS, tracker),
    ...credentialsFor(SOURCE_CREDENTIALS, source),
  ];
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

/**
 * Explain which routing key implied each credential.
 *
 * The preflight reports a missing credential to whoever has to fix it, and
 * "GH_TOKEN is required" is a much weaker sentence than "GH_TOKEN is required
 * because tracker is github". The second names the line of config to change if
 * the requirement itself is wrong, which is the other valid remedy.
 * @param {{tracker?: string, source?: string}} [routing] Vendor routing.
 * @returns {Record<string, string[]>} Credential name to the reasons for it.
 */
export function routingFloorReasons(routing = {}) {
  const tracker = normalize(routing.tracker);
  const source = normalize(routing.source);
  const reasons = {};
  for (const name of credentialsFor(TRACKER_CREDENTIALS, tracker)) {
    reasons[name] = [`tracker is "${tracker}"`];
  }
  for (const name of credentialsFor(SOURCE_CREDENTIALS, source)) {
    reasons[name] = [...(reasons[name] ?? []), `source is "${source}"`];
  }
  return reasons;
}

/**
 * Look a vendor up without consulting anything it inherited.
 *
 * A routing value reaches these maps as an arbitrary string from a config file,
 * and plain indexing answers `constructor` and `__proto__` with inherited
 * members rather than with undefined — so `?? []` never fires and spreading the
 * result throws `not iterable`. `routingFloor` runs inside `readConfig`, which
 * means a typo in `tracker` would abort configuration loading with an
 * iterability error, in place of the documented behavior: an unrecognised
 * vendor contributes nothing, and routing dispatch reports the typo in its own
 * vocabulary.
 * @param {Record<string, string[]>} map Credential map to read.
 * @param {string} key Normalized vendor name.
 * @returns {string[]} Declared credentials, empty for anything not declared.
 */
function credentialsFor(map, key) {
  return Object.hasOwn(map, key) ? map[key] : [];
}

/**
 * Substrates that satisfy a credential without the variable being set.
 *
 * A required name is a proxy for a capability, not an end in itself, and some
 * capabilities have a second legitimate route. `gh` authenticates from its own
 * keyring after `gh auth login`, so a laptop can drive every GitHub operation
 * Lisa performs with `GH_TOKEN` unset — which is the normal state of a
 * developer machine, not a misconfiguration.
 *
 * Without this the floor fails a local session over a credential that surface
 * demonstrably does not need. That is worse than not checking: a control that
 * fires when nothing is wrong is one people learn to skip, and it would have
 * fired on every session in Lisa's own repository.
 *
 * This mirrors the credential-substrate-precedence contract the access skills
 * already follow — a capability is proven by whichever substrate can serve it,
 * not by one hardcoded variable.
 *
 * Kept deliberately small. An entry belongs here only when the alternative is
 * genuinely equivalent for everything Lisa does with that credential and can be
 * proven by a cheap local command. `ATLASSIAN_API_TOKEN` is not listed even
 * though `acli` exists, because the contract ranks the token first and acli
 * covers only part of the surface.
 */
export const SUBSTITUTE_SUBSTRATES = {
  GH_TOKEN: {
    command: "gh",
    args: ["auth", "status"],
    describes: "the gh CLI is authenticated (gh auth login)",
  },
};

/**
 * Lower-case a routing value, treating blank and absent as the same.
 * @param {unknown} value Raw routing value.
 * @returns {string} A comparable key, empty when nothing was declared.
 */
function normalize(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
