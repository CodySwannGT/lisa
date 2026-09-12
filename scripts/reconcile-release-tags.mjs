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
 * ## One probe, not two (issue #3804)
 *
 * The question "did this exact version reach the registry?" has ONE
 * implementation, `verifyPublish` in `check-npm-publish-landed.mjs`, and this
 * sweep calls it. It used to carry its own URL builder, its own fetch and its
 * own body check, written in parallel with that module because the module was
 * unmerged at the time. Two of them agreed only because two people had aligned
 * the semantics by hand — including one real divergence caught in review, where
 * this file accepted any HTTP 200 while the module also required the response
 * body to name the version asked for. Both surfaces reporting `published` about
 * one release have to mean the same thing by it, and that now rests on there
 * being one implementation rather than on an agreement.
 *
 * WHAT DID NOT CONVERGE, DELIBERATELY: the retry policy and the exit code. See
 * `probeVersion` for the first; the second is simply that `main` here returns
 * nothing and the module's exit-1 CLI is never imported.
 *
 * @module scripts/reconcile-release-tags
 */

import { verifyPublish } from "../all/copy-overwrite/scripts/check-npm-publish-landed.mjs";

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
 * What a single registry probe establishes, in this sweep's vocabulary.
 *
 * The probe itself no longer lives here — `verifyPublish` decides which of the
 * three words an HTTP answer earns, and it already applies the rule this
 * function used to apply: only a definitive 404 on the EXACT-VERSION endpoint
 * proves absence, while a 200 naming a different version, an auth failure, a
 * rate limit, a timeout and any transport error all establish nothing.
 *
 * This is kept as the sweep's own boundary rather than dropped as a
 * pass-through. It is total: ANY outcome it does not recognise — a fourth
 * verdict added upstream, a malformed result, no result at all — is read as
 * `unprovable`. That default is the safe direction, because the damage this
 * sweep can do is reporting a good release as absent, and an unrecognised word
 * falling through to `missing` is exactly how that would happen.
 * @param {object} outcome The result of one `verifyPublish` call.
 * @param {string|null} [outcome.verdict] The verdict that call settled on.
 * @returns {string} One of the `VERDICT` values.
 */
export function classifyProbe({ verdict = null } = {}) {
  if (verdict === VERDICT.PUBLISHED) return VERDICT.PUBLISHED;
  if (verdict === VERDICT.MISSING) return VERDICT.MISSING;
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
 * Probe a version through the shared implementation, retrying ONLY while the
 * answer is `unprovable`.
 *
 * THE RETRY POLICY IS THIS SWEEP'S, AND IT IS NOT THE MODULE'S. `verifyPublish`
 * retries both non-`published` verdicts, because at release time a version that
 * has just been published can lag the exact-version endpoint for a moment, so
 * re-asking after a 404 is worth the wait. This sweep looks backwards at tags
 * that are often years old, where a 404 is settled: re-asking would be asking
 * the registry to change its mind, and paying for it 1,774 times. So the module
 * is called with `attempts: 1` — one question per call, no internal retry — and
 * the loop that decides whether to ask again lives here, where the timeline it
 * reasons about lives. Same principle, different positions on that timeline;
 * neither caller's behaviour moved when the probe converged.
 *
 * Re-asking an `unprovable` matters at sweep scale rather than for a single
 * release. The first real run over 1,699 tags produced two `unprovable` rows,
 * and one of them was `v2.325.4` — a version that IS published, whose probe
 * simply failed in flight. Without a re-probe every sweep carries a couple of
 * rows an operator has to chase by hand, which is how a report starts getting
 * skimmed.
 * @param {string} pkg The package name.
 * @param {string} version The exact version.
 * @param {object} [options] Retry controls.
 * @param {number} [options.attempts] Total attempts, including the first.
 * @param {() => Promise<void>} [options.pause] Delay between attempts.
 * @param {typeof fetch} [options.fetchImpl] Injected for tests.
 * @returns {Promise<{verdict: string, detail: string}>} The settled outcome.
 */
export async function probeVersion(
  pkg,
  version,
  { attempts = 2, pause = async () => {}, fetchImpl = fetch } = {}
) {
  let last = { verdict: VERDICT.UNPROVABLE, detail: "not attempted" };
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    if (attempt > 0) await pause();
    last = await verifyPublish({
      packageName: pkg,
      version,
      attempts: 1,
      fetchImpl,
    });
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
    probes.set(version, await probeVersion(pkg, version));
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
