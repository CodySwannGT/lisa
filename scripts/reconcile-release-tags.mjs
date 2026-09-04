#!/usr/bin/env node
/**
 * Which version tags correspond to a release that actually reached the registry (issue #3751).
 *
 * A tag is the artifact people trust when they ask "which version is live?",
 * precisely because it looks authoritative. This repository pushes the tag
 * BEFORE the step that makes a release a release for a consumer, so a tag can
 * outlive the failure of the thing it asserts:
 *
 *   deploy.yml
 *     release  (release.yml)
 *       version             computes the version
 *       release_signing     git tag -s + git push refs/tags/...   <- TAG PUSHED
 *       release_attestation
 *       github_release      GitHub Release created
 *     publish_npm  needs:[release]  (publish-to-npm.yml)
 *       npm publish ...                                           <- PUBLISH, AFTER
 *
 * `npm publish` runs in a separate downstream job, so the attestation, the
 * GitHub Release and the whole publish job all happen after the tag exists.
 *
 * THE ORDERING IS DELIBERATE AND THIS SCRIPT DOES NOT CHANGE IT. Tagging early
 * is what lets a re-run see "this version was already cut" and resume instead
 * of duplicating. Moving the tag to the end would trade that away, and the
 * alternatives are each worse: deleting a pushed tag is its own hazard once a
 * consumer may have fetched it, and "tag early, mark incomplete" needs a place
 * to record incompleteness that does not exist. So the tag stays where it is
 * and this reconciles the residue instead.
 *
 * ## Three verdicts, because two would be a licence to do harm
 *
 * The verdicts are `published`, `missing` and `unprovable`, and the third is
 * the load-bearing one. Retracting or flagging a GOOD release because the
 * registry was briefly unreachable is the one direction this work can do harm,
 * so anything that is not a definitive 404 on the exact-version endpoint is
 * `unprovable` — a rate limit, a 5xx, a DNS failure, an auth error and a
 * timeout are all "ask again later", never "this release did not happen".
 *
 * Note the asymmetry that makes this safe: `published` and `missing` are
 * claims about the registry, while `unprovable` is a claim about THIS RUN.
 *
 * ## Bounded false positives (explicit acceptance criterion)
 *
 * A reconciliation that flags everything is as useless as one that flags
 * nothing, and it looks far more diligent while doing it. The first draft of
 * this scan reported 765 releases as untagged; every one was a false positive
 * caused by reading only ONE of this repository's two tag conventions.
 *
 *   - Two conventions are recognised: the current `v1.2.3` and the earlier
 *     `vv1.2.3`. Reading only the first misclassifies 765 correctly-tagged
 *     releases as untagged and hides 13 genuine orphans. This is the single
 *     highest-value line in the file and is pinned by a regression test.
 *   - Non-version refs (`backup/...`, `_fleet/...`, `pr-assets`) are not
 *     release tags and are never rows.
 *   - A prerelease or build-metadata suffix is not a plain release tag and is
 *     not reconciled here rather than being guessed at.
 *   - The tag list is the input; a version published with no tag at all is
 *     reported separately, because it is a different defect from a tag with no
 *     publication and conflating them produces a number nobody can act on.
 *
 * ## What this deliberately does NOT read
 *
 * It does not read workflow run history. That axis belongs to the release-time
 * reconciliation (#3684), and it carries a trap worth recording here so the
 * next reader does not walk into it: the default
 * `GET /actions/runs/<id>/jobs` endpoint returns jobs for the LATEST ATTEMPT
 * only. A run whose failed job was re-run, where the re-run was then cancelled,
 * truthfully reports `{"total_count": 0, "jobs": []}` while holding its real
 * jobs one attempt down, and `gh run view <id> --log` exits 0 printing nothing.
 * A sweep built on those defaults would read a KNOWN failed release as having
 * no evidence and return `unprovable` — the verdict that means "do not act".
 * Use `attempts/<n>/jobs` or `?filter=all`.
 *
 * @module scripts/reconcile-release-tags
 */

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * The verdicts, shared with the release-time reconciliation.
 *
 * One vocabulary for one concept: a second set of strings for the same three
 * states is how two tickets about one incident start disagreeing in reports
 * that are supposed to be compared.
 */
export const VERDICT = Object.freeze({
  PUBLISHED: "published",
  MISSING: "missing",
  UNPROVABLE: "unprovable",
});

/**
 * Both tag conventions this repository has used, current first.
 *
 * `vv1.2.3` is not a typo — it is what the early release process produced, and
 * 765 releases carry it. A pattern anchored to a single `v` silently reads
 * every one of them as untagged.
 */
const VERSION_TAG = /^vv?(\d+\.\d+\.\d+)$/;

/**
 * The version a release tag names, or null when the ref is not a release tag.
 * @param {string} tag A git ref name, without `refs/tags/`.
 * @returns {string|null} The bare `x.y.z` version, or null.
 */
export function parseVersionTag(tag) {
  const matched = VERSION_TAG.exec(String(tag ?? "").trim());
  return matched ? matched[1] : null;
}

/**
 * What a single registry probe establishes.
 *
 * Only a definitive 404 on the EXACT-VERSION endpoint proves absence. Every
 * other outcome — including a 200 that is not the version asked for, an auth
 * failure, a rate limit and any transport error — establishes nothing about
 * whether the release happened, and says so rather than guessing.
 * @param {object} probe The probe result.
 * @param {number|null} [probe.status] HTTP status, or null when none was received.
 * @param {string|null} [probe.error] Transport-level failure, if any.
 * @returns {string} One of the `VERDICT` values.
 */
export function classifyProbe({ status = null, error = null } = {}) {
  if (error) return VERDICT.UNPROVABLE;
  if (status === 200) return VERDICT.PUBLISHED;
  if (status === 404) return VERDICT.MISSING;
  return VERDICT.UNPROVABLE;
}

/**
 * Reconcile a tag list against a set of probes.
 *
 * Pure: the caller supplies both the refs and a probe function, so the
 * classification is testable without a network and a fixture can reproduce a
 * registry outage exactly.
 * @param {object} options Inputs.
 * @param {readonly string[]} options.tags Every ref name in the repository.
 * @param {(version: string) => {status?: number|null, error?: string|null}} options.probe Registry probe.
 * @returns {{rows: object[], ignored: string[]}} Rows per release tag, and refs that were not release tags.
 */
export function reconcile({ tags, probe }) {
  const rows = [];
  const ignored = [];
  for (const tag of tags) {
    const version = parseVersionTag(tag);
    if (version === null) {
      ignored.push(tag);
      continue;
    }
    rows.push({ tag, version, verdict: classifyProbe(probe(version)) });
  }
  return { rows, ignored };
}

/**
 * The exact-version registry endpoint for one version.
 *
 * EXACT VERSION, never `dist-tags.latest`. `latest` lags a successful publish
 * by minutes, so reconciling against it reports a release that shipped moments
 * ago as absent — a false `missing` on the newest and most-scrutinised release.
 * @param {string} pkg The package name.
 * @param {string} version The exact version.
 * @returns {string} The URL to probe.
 */
export function registryUrl(pkg, version) {
  return `https://registry.npmjs.org/${pkg.replace("/", "%2f")}/${version}`;
}

/**
 * Probe the registry for one version, converting every failure into a shape
 * `classifyProbe` can read rather than throwing.
 * @param {string} pkg The package name.
 * @param {string} version The exact version.
 * @param {typeof fetch} [fetchImpl] Injected for tests.
 * @returns {Promise<{status: number|null, error: string|null}>} The probe result.
 */
export async function probeRegistry(pkg, version, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(registryUrl(pkg, version), {
      method: "GET",
    });
    if (response.status !== 200)
      return { status: response.status, error: null };
    // A 200 IS NOT ENOUGH — the body has to name the version that was asked
    // for. This matches the release-time check (#3684) exactly: a 200 whose
    // body names something else, or which does not parse, settles nothing and
    // is `unprovable` rather than `published`. Two surfaces reporting the same
    // word about one release have to mean the same thing by it, or comparing
    // their reports is meaningless.
    let body;
    try {
      body = await response.json();
    } catch (error) {
      return {
        status: null,
        error: `unparseable body: ${String(error?.message ?? error)}`,
      };
    }
    if (body?.version !== version)
      return {
        status: null,
        error: `registry served version ${String(body?.version)} for ${version}`,
      };
    return { status: 200, error: null };
  } catch (error) {
    // A transport failure is NOT evidence of absence. Returning it as an error
    // is what makes `classifyProbe` answer `unprovable` instead of `missing`.
    return { status: null, error: String(error?.message ?? error) };
  }
}

/**
 * Probe a version, retrying ONLY while the answer is `unprovable`.
 *
 * A retry loop that also re-ran `missing` would be asking the registry to
 * change its mind about a definite 404, and one that re-ran `published` would
 * double the cost of the common case. Only "we could not look" is worth
 * looking again at.
 *
 * This matters at sweep scale rather than for a single release. The first real
 * run over 1,699 tags produced two `unprovable` rows, and one of them was
 * `v2.325.4` — a version that IS published, whose probe simply failed in
 * flight. Without a re-probe every sweep carries a couple of rows an operator
 * has to chase by hand, which is how a report starts getting skimmed.
 * @param {string} pkg The package name.
 * @param {string} version The exact version.
 * @param {object} [options] Retry controls.
 * @param {number} [options.attempts] Total attempts, including the first.
 * @param {() => Promise<void>} [options.pause] Delay between attempts.
 * @param {typeof fetch} [options.fetchImpl] Injected for tests.
 * @returns {Promise<{status: number|null, error: string|null}>} The last probe result.
 */
export async function probeWithRetry(
  pkg,
  version,
  { attempts = 2, pause = async () => {}, fetchImpl = fetch } = {}
) {
  let last = { status: null, error: "not attempted" };
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    if (attempt > 0) await pause();
    last = await probeRegistry(pkg, version, fetchImpl);
    if (classifyProbe(last) !== VERDICT.UNPROVABLE) return last;
  }
  return last;
}

/**
 * The operator-facing report.
 *
 * SAYS WHAT THE VERDICTS MEAN, IN THE OUTPUT. A bare count of orphan tags
 * reads as a count of failed releases, and those are different claims: this
 * repository has 26 tags with no published version and exactly one of them is
 * a proven failed release. Someone reading the report in a hurry must not be
 * able to take the number for an incident count, so the distinction is printed
 * rather than left in a doc comment nobody opens.
 * @param {{rows: object[], ignored: string[]}} result As returned by `reconcile`.
 * @returns {string} The report.
 */
export function formatReport({ rows, ignored }) {
  const of = verdict => rows.filter(row => row.verdict === verdict);
  const missing = of(VERDICT.MISSING);
  const unprovable = of(VERDICT.UNPROVABLE);
  return [
    "Release-tag reconciliation",
    "",
    `  release tags     ${rows.length}`,
    `  non-release refs ${ignored.length}`,
    `  published        ${of(VERDICT.PUBLISHED).length}`,
    `  missing          ${missing.length}`,
    `  unprovable       ${unprovable.length}`,
    "",
    "What the verdicts claim:",
    "  published  — the exact version answered 200 on the registry.",
    "  missing    — a claim about THE REGISTRY: the exact version answered 404.",
    "               It is NOT a claim that a release run failed. A tag can lack",
    "               a published version because the publish failed, because the",
    "               version was unpublished inside npm's 72-hour window, or",
    "               because it predates publishing from this repository.",
    "               Each one needs its release run read before it is called an",
    "               incident.",
    "  unprovable — a claim about THIS RUN: the registry could not be reached,",
    "               or answered something that settles nothing. Never treat it",
    "               as absence; run it again.",
    "",
    ...(missing.length
      ? [
          "Tags with no published version:",
          ...missing.map(r => `  ${r.tag}`),
          "",
        ]
      : []),
    ...(unprovable.length
      ? [
          "Not established by this run (re-run before drawing any conclusion):",
          ...unprovable.map(r => `  ${r.tag}`),
          "",
        ]
      : []),
  ].join("\n");
}

/**
 * CLI entry point.
 */
async function main() {
  const pkg = process.env.LISA_RECONCILE_PACKAGE ?? "@codyswann/lisa";
  const { execFileSync } = await import("node:child_process");
  const tags = execFileSync("git", ["tag", "--list"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  const probes = new Map();
  for (const tag of tags) {
    const version = parseVersionTag(tag);
    if (version === null || probes.has(version)) continue;
    probes.set(version, await probeWithRetry(pkg, version));
  }

  const result = reconcile({
    tags,
    probe: version => probes.get(version) ?? {},
  });
  console.log(formatReport(result));
  // Report-only: an orphan tag is a finding for a human to classify, not a
  // build to fail. Exiting non-zero here would make every consumer of this
  // script treat 26 historical tags as a red.
}

if (invokedAsScript(import.meta.url)) {
  main();
}
