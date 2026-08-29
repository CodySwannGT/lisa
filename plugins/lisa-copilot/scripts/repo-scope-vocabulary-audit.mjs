#!/usr/bin/env node
/**
 * Repo-scope vocabulary audit for `/lisa:validate-tracker-mapping`.
 *
 * ## The gap this closes
 *
 * `scoping-label-audit.mjs` walks the OPEN scoping families — `type:`,
 * `priority:`, `points:`, `component:` — and reports smells about them. It
 * deliberately does not walk `repo:`, and `repo:` is the one family where a
 * wrong answer is not a matter of taste: it decides which work items a repo's
 * build queue can see. When the repo vocabulary drifts, a scan filtering on
 * the canonical spelling returns FEWER items, not an error, and an empty
 * result is indistinguishable from "nothing to do". Work sits unrouted and
 * nobody is told.
 *
 * ## Why this family asserts membership when `component:` may not
 *
 * The ruling on #3420 — Lisa asserts no authority over project label
 * vocabularies — is about vocabularies that are OPEN and PROJECT-SPECIFIC. An
 * open vocabulary has no wrong member, only inconsistent ones, and declaring
 * one in config would demand per-project curation that becomes its own drift
 * surface. None of that describes `repo:`:
 *
 * - `config-resolution` already declares `repo:<name>` canonical and uniform
 *   across trackers, so the canonical FORM is settled upstream, not per project.
 * - The MEMBERS are derived, never curated: the caller resolves them from the
 *   repo-identity ladder (config `repo` → `github.repo` → git remote basename)
 *   and, in batch mode, from the sibling projects sharing one tracker. This
 *   module takes them as input and adds no config key.
 *
 * So there is nothing here for a human to hand-maintain, and no new place for
 * the declaration itself to drift.
 *
 * ## Why these findings are drift and not smells
 *
 * The other families need a heuristic — is `component:plugin` a typo of
 * `component:plugins`? — and a heuristic is sometimes wrong, which is why those
 * findings are advisory. Nothing here is a guess. `assertRepoScope`
 * (`lisa-work-item.mjs`, #1957) accepts THREE spellings as valid repo scope:
 *
 *     repo:<name>   canonical
 *     <name>        bare label — Sentry-provenance items arrive carrying only this
 *     <name>        Jira component equal to the bare name
 *
 * The bare branch is deliberate and load-bearing; removing it would break that
 * ingestion path. But every build-intake scanner FILTERS on `repo:<name>`. So
 * an item carrying only the bare spelling passes validation while being
 * invisible to every scan that looks for it. That is not a smell about which
 * reasonable people differ — it is a checkable disagreement between what
 * validation accepts and what filtering finds, and it is the exact shape of the
 * under-read this audit exists to make loud.
 *
 * ## Why nothing here is ever auto-repaired
 *
 * Every finding is `autoRepairable: false`, including under `repair=true`.
 * `repair=true` may rewrite the CONFIG, never the tracker, and every fix
 * available here is a tracker mutation: stamping the canonical label on an
 * item, renaming a malformed marker, or deciding whether an undeclared scope
 * names a real repo or a typo. A human decides; this module reports.
 *
 * @module plugins/src/base/scripts/repo-scope-vocabulary-audit
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The family this module audits. Canonical marker form is `repo:<name>`. */
export const REPO_SCOPE_FAMILY = "repo";

/** The canonical separator between the family and the repo name. */
export const CANONICAL_SEPARATOR = ":";

/**
 * Separators seen standing in for the canonical `:` on a repo marker.
 *
 * A label like `repo-frontend` reads to a human as a repo marker and is not
 * one: no scanner filters on it, and `assertRepoScope` does not accept it
 * either, so it scopes an item to nothing at all. Observed on a live tracker
 * alongside the canonical form, carrying zero items — a vocabulary that had
 * split without anything noticing.
 */
export const MALFORMED_SEPARATORS = Object.freeze(["-", "_", "/", "."]);

/** Every finding this module can emit. All of them are real drift. */
export const REPO_SCOPE_FINDING_KINDS = Object.freeze([
  "unstamped-alias",
  "malformed-marker",
  "undeclared-scope",
]);

/**
 * @typedef {{
 *   readonly ref?: string
 *   readonly labels?: readonly (string | { readonly name?: string })[]
 *   readonly components?: readonly (string | { readonly name?: string })[]
 * }} WorkItem
 *
 * @typedef {{
 *   readonly family: "repo"
 *   readonly kind: string
 *   readonly label: string
 *   readonly repo?: string
 *   readonly canonical?: string
 *   readonly items: readonly string[]
 *   readonly severity: "drift"
 *   readonly autoRepairable: false
 *   readonly detail: string
 * }} RepoScopeFinding
 */

/**
 * Normalize a label/component list to lowercase names, as `assertRepoScope`
 * does. Its matching is case-insensitive, so a bare `Infrastructure` label
 * scopes an item to `infrastructure` — and is just as invisible to a
 * `repo:infrastructure` filter as a lowercase one would be.
 *
 * @param {readonly (string | { readonly name?: string })[] | undefined} value
 * @returns {string[]} lowercased names, non-strings dropped
 */
export function namesFrom(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => (typeof item === "string" ? item : item?.name))
    .filter(name => typeof name === "string")
    .map(name => name.trim().toLowerCase())
    .filter(name => name.length > 0);
}

/**
 * The canonical repo marker for a repo short name.
 *
 * @param {string} repo
 * @returns {string} e.g. `repo:frontend`
 */
export function canonicalRepoLabel(repo) {
  return `${REPO_SCOPE_FAMILY}${CANONICAL_SEPARATOR}${String(repo).trim().toLowerCase()}`;
}

/**
 * Split a label that is shaped like a repo marker into its separator and value.
 *
 * Returns `null` for anything that does not begin `repo<separator>` — a bare
 * repo name is not a marker (it is an alias, handled per item, because whether
 * it is drift depends on what else that item carries), and `component:frontend`
 * belongs to another family entirely.
 *
 * @param {unknown} name
 * @returns {{ separator: string, value: string } | null}
 */
export function parseRepoMarker(name) {
  if (typeof name !== "string") return null;
  const trimmed = name.trim().toLowerCase();
  if (!trimmed.startsWith(REPO_SCOPE_FAMILY)) return null;

  const separator = trimmed.slice(
    REPO_SCOPE_FAMILY.length,
    REPO_SCOPE_FAMILY.length + 1
  );
  if (
    separator !== CANONICAL_SEPARATOR &&
    !MALFORMED_SEPARATORS.includes(separator)
  ) {
    return null;
  }

  const value = trimmed.slice(REPO_SCOPE_FAMILY.length + 1).trim();
  if (value.length === 0) return null;
  return { separator, value };
}

/**
 * Audit a tracker's repo-scoping vocabulary.
 *
 * Total and read-only: mutates nothing, reaches nothing over the network, and
 * returns every finding rather than the first.
 *
 * @param {{
 *   readonly knownRepos?: readonly string[]
 *   readonly items?: readonly WorkItem[]
 *   readonly labels?: readonly (string | { readonly name?: string })[]
 * }} input
 *   `knownRepos` is the derived repo vocabulary — the repo-identity ladder for
 *   a single project, or the sibling set in batch mode. `items` are the live
 *   work items with their labels (and Jira components). `labels` is the
 *   tracker's declared label set, which catches a malformed marker carrying
 *   zero items.
 * @returns {{
 *   readonly verdict: "VALID" | "DRIFTED" | "UNRESOLVABLE"
 *   readonly findings: readonly RepoScopeFinding[]
 *   readonly knownAliases: readonly { readonly label: string, readonly canonical: string, readonly items: readonly string[] }[]
 *   readonly vocabulary: readonly string[]
 * }}
 */
export function auditRepoScopeVocabulary(input = {}) {
  const vocabulary = [
    ...new Set(
      (Array.isArray(input.knownRepos) ? input.knownRepos : [])
        .filter(repo => typeof repo === "string")
        .map(repo => repo.trim().toLowerCase())
        .filter(repo => repo.length > 0)
    ),
  ];

  // An empty vocabulary cannot be audited, and reporting VALID for it would
  // reproduce the very failure this module exists to catch: a check that
  // returns "nothing wrong" when it in fact looked at nothing.
  if (vocabulary.length === 0) {
    return {
      verdict: /** @type {const} */ ("UNRESOLVABLE"),
      findings: [],
      knownAliases: [],
      vocabulary,
    };
  }

  const items = Array.isArray(input.items) ? input.items : [];
  const { aliasFindings, knownAliases } = aliasUsage(items, vocabulary);

  const findings = [
    ...aliasFindings,
    ...markerFindings(declaredNames(input.labels, items), vocabulary),
  ];

  return {
    verdict: /** @type {const} */ (findings.length === 0 ? "VALID" : "DRIFTED"),
    findings,
    knownAliases,
    vocabulary,
  };
}

/**
 * Every label name in play: the tracker's declared set unioned with the labels
 * observed on items.
 *
 * The declared set is what catches a malformed marker nobody has applied yet —
 * a label sitting at zero usage beside the canonical form is a vocabulary that
 * has already split, and the next item to receive it disappears from the queue.
 *
 * @param {readonly (string | { readonly name?: string })[] | undefined} labels
 * @param {readonly WorkItem[]} items
 * @returns {string[]}
 */
function declaredNames(labels, items) {
  return [
    ...new Set([
      ...namesFrom(labels),
      ...items.flatMap(item => namesFrom(item?.labels)),
    ]),
  ];
}

/**
 * Per item, per known repo: does what `assertRepoScope` accepts agree with what
 * a canonical filter would find?
 *
 * An item carrying an accepted alias — the bare repo name as a label, or as a
 * Jira component — WITHOUT the canonical `repo:<name>` beside it passes
 * validation and is invisible to every scan. Carrying both is a known alias
 * and harmless: the item is still found. That difference is the whole check,
 * and it is why an alias cannot be judged from the label set alone.
 *
 * @param {readonly WorkItem[]} items
 * @param {readonly string[]} vocabulary
 * @returns {{ aliasFindings: RepoScopeFinding[], knownAliases: { label: string, canonical: string, items: string[] }[] }}
 */
function aliasUsage(items, vocabulary) {
  /** @type {Map<string, { repo: string, items: string[] }>} */
  const unstamped = new Map();
  /** @type {Map<string, { repo: string, items: string[] }>} */
  const stamped = new Map();

  items.forEach((item, index) => {
    const ref = itemRef(item, index);
    const labelNames = namesFrom(item?.labels);
    const componentNames = namesFrom(item?.components);

    for (const repo of vocabulary) {
      const aliases = [
        labelNames.includes(repo) ? repo : undefined,
        componentNames.includes(repo) ? `component:${repo}` : undefined,
      ].filter(alias => alias !== undefined);
      if (aliases.length === 0) continue;

      const bucket = labelNames.includes(canonicalRepoLabel(repo))
        ? stamped
        : unstamped;
      for (const alias of aliases) {
        if (!bucket.has(alias)) bucket.set(alias, { repo, items: [] });
        bucket.get(alias).items.push(ref);
      }
    }
  });

  return {
    aliasFindings: [...unstamped].map(([label, entry]) => ({
      family: /** @type {const} */ (REPO_SCOPE_FAMILY),
      kind: "unstamped-alias",
      label,
      repo: entry.repo,
      canonical: canonicalRepoLabel(entry.repo),
      items: entry.items,
      severity: /** @type {const} */ ("drift"),
      autoRepairable: /** @type {const} */ (false),
      detail:
        `"${label}" is an accepted alias for repository "${entry.repo}", so ` +
        `${entry.items.length} work item(s) carrying it pass repo-scope ` +
        `validation — but they do not carry "${canonicalRepoLabel(entry.repo)}", ` +
        `which is what every build-intake scan filters on. Those items are ` +
        `invisible to that scan, and the scan reports no error. Stamping the ` +
        `canonical label alongside the alias is a tracker change a human makes.`,
    })),
    knownAliases: [...stamped].map(([label, entry]) => ({
      label,
      canonical: canonicalRepoLabel(entry.repo),
      items: entry.items,
    })),
  };
}

/**
 * Label-set findings: markers that look canonical and are not, and canonical
 * markers naming a repo outside the derived vocabulary.
 *
 * @param {readonly string[]} names
 * @param {readonly string[]} vocabulary
 * @returns {RepoScopeFinding[]}
 */
function markerFindings(names, vocabulary) {
  return names.flatMap(name => {
    const marker = parseRepoMarker(name);
    if (!marker) return [];

    if (marker.separator !== CANONICAL_SEPARATOR) {
      // Only a malformed marker naming a KNOWN repo is reportable. `repo-x` for
      // an unknown `x` is just a label whose name happens to start with "repo";
      // calling it drift would report every unrelated label into the noise.
      if (!vocabulary.includes(marker.value)) return [];
      return [
        {
          family: /** @type {const} */ (REPO_SCOPE_FAMILY),
          kind: "malformed-marker",
          label: name,
          repo: marker.value,
          canonical: canonicalRepoLabel(marker.value),
          items: [],
          severity: /** @type {const} */ ("drift"),
          autoRepairable: /** @type {const} */ (false),
          detail:
            `"${name}" is shaped like a repo marker but uses "${marker.separator}" ` +
            `where the canonical form uses "${CANONICAL_SEPARATOR}". It scopes ` +
            `nothing: no scan filters on it, and repo-scope validation does not ` +
            `accept it either. The canonical form is ` +
            `"${canonicalRepoLabel(marker.value)}".`,
        },
      ];
    }

    if (vocabulary.includes(marker.value)) return [];
    return [
      {
        family: /** @type {const} */ (REPO_SCOPE_FAMILY),
        kind: "undeclared-scope",
        label: name,
        repo: marker.value,
        items: [],
        severity: /** @type {const} */ ("drift"),
        autoRepairable: /** @type {const} */ (false),
        detail:
          `"${name}" scopes work to a repository "${marker.value}" that is not ` +
          `in the derived vocabulary (${vocabulary.join(", ")}). Either it names ` +
          `a repository this tracker serves — in which case the project set is ` +
          `incomplete — or it is a misspelling routing work nowhere. Both are ` +
          `human decisions, so this is never repaired automatically.`,
      },
    ];
  });
}

/**
 * A stable, reportable identifier for a work item.
 *
 * @param {WorkItem} item
 * @param {number} index
 * @returns {string}
 */
function itemRef(item, index) {
  const ref = item?.ref;
  return typeof ref === "string" && ref.trim().length > 0
    ? ref.trim()
    : `item[${index}]`;
}

/**
 * CLI: read `{ knownRepos, items, labels }` on stdin, print the audit.
 *
 * Exits 0 even when the verdict is DRIFTED. The verdict is what the caller
 * reports; the exit status is not a second, quieter channel for the same
 * answer, and a non-zero exit would make this a gate the first time something
 * ran it under `set -e`.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

  process.stdout.write(
    `${JSON.stringify(
      auditRepoScopeVocabulary({
        knownRepos: payload.knownRepos,
        items: payload.items,
        labels: payload.labels,
      }),
      null,
      2
    )}\n`
  );
}

/**
 * True when `moduleUrl` names the module node was asked to run.
 *
 * Written out rather than imported: this is a plugin payload, which has no
 * `./lib/` to resolve against. Same rule and same reasoning as
 * `scripts/lib/invoked-as-script.mjs` and `scoping-label-audit.mjs`.
 *
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
export function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
