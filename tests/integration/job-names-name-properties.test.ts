/**
 * A CI job names the property it proves, never the tool that proves it.
 *
 * The mirror of `gate-labels-name-properties`, over the other half of the same
 * ruling. That suite checks 35 product names against every registry LABEL and
 * covers every façaded job; three job names sit outside it, and one of them —
 * `playwright_e2e_setup` — was found only by sweeping both workflows by hand.
 * A control that requires a manual sweep to be complete is not a control.
 *
 * WHY THE JOB NAME AND NOT ONLY THE LABEL. A job's `name:` IS the
 * branch-protection context: a ruleset matches it by exact string. A vendor
 * there is a vendor compiled into branch protection, so "swap Snyk for
 * something else" stops being a config edit and becomes a coordinated ruleset
 * migration in every consumer repository.
 *
 * THE RULING'S DIRECTION, recorded so nobody reverses it: the job name moves to
 * the gate's label, never the label to the job name.
 *
 * THE LAST EXEMPTION IS GONE, and how it went is the part worth keeping. The
 * `snyk` entry read "cannot take its gate's label" and was applied as "cannot
 * be renamed" — two different claims. It is the SECOND prover of
 * `dependency-vulnerability` (`SECONDARY_PROVER_JOBS` in the shipped registry),
 * so by construction it may never wear `🔒 Security Scan`: `npm_security_scan`
 * carries that label and `contextsFor` derives the required context from the
 * LABEL, so a second job posting it would be two provers under one context.
 * That forecloses one destination, not every destination. A secondary prover
 * needs a property-shaped name that is NOT its gate's label, and
 * `🛡️ Supply Chain Scan` is the property it actually proves at a depth the
 * ship-scope audit does not reach (`--all-projects`).
 *
 * WHY THE RENAME STRANDED NOBODY, measured rather than assumed. Renaming a job
 * renames the context it posts, and a ruleset pinned to the old string then
 * waits forever on a check that will never report. `🛡️ Snyk Dependency Scan`
 * was pinned by nothing: `contextsFor` never derives it (secondary provers have
 * no label), this repository's own ruleset does not list it, the shipped
 * ruleset seed and its example roster do not list it, and a live sweep of every
 * required status check across the 27 repositories in the portfolio — 374
 * context rows over 26 readable rulesets — returned zero matches for it. The
 * falsifier is stated so it can expire: a consumer OUTSIDE that sweep who
 * hand-pinned the old string is stranded, and the fix there is the recorded
 * sequence — remove the old context, merge, add the new.
 *
 * @module tests/integration/job-names-name-properties
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadWorkflow } from "../helpers/workflow-test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Both reusable workflows this repository ships, repository-relative. */
const WORKFLOWS: readonly string[] = [
  ".github/workflows/quality.yml",
  ".github/workflows/playwright-e2e.yml",
];

/**
 * Third-party product names that must not appear in a job name.
 *
 * Kept in step with the label suite's list on purpose: the rule is one ruling
 * about the SHAPE of a check name, and two lists would drift into two rules.
 * A denylist rather than an allowlist, for the reason that suite gives — an
 * allowlist of permitted words would have to enumerate English.
 */
const VENDORS: readonly string[] = [
  "aikido",
  "ast-grep",
  "ast grep",
  "chromatic",
  "codeclimate",
  "coderabbit",
  "codecov",
  "cypress",
  "datadog",
  "dependabot",
  "detox",
  "eslint",
  "fossa",
  "gitguardian",
  "gitleaks",
  "jest",
  "knip",
  "lighthouse",
  "maestro",
  "mocha",
  "owasp",
  "oxlint",
  "playwright",
  "prettier",
  "renovate",
  "semgrep",
  "snyk",
  "sonarcloud",
  "sonarqube",
  "stryker",
  "trufflehog",
  "trivy",
  "veracode",
  "vitest",
  "whitesource",
  "zap",
];

/**
 * Job names that still carry a vendor, and what blocks each rename.
 *
 * EMPTY, and kept rather than deleted. The table is one side of a
 * both-directions comparison: the offender set derived from the YAML is
 * asserted equal to these keys, so an empty table is now an assertion that the
 * workflows contain no vendor-named job at all — and adding one silently fails
 * the suite rather than passing unnoticed.
 *
 * A future entry must state what BLOCKS the rename, not merely that one is
 * inconvenient, and the reason is length-checked below. The entry this table
 * used to hold is the cautionary case: it named a real constraint (a secondary
 * prover may not wear its gate's label) and was read as a general one, which
 * kept a vendor in a check name for two releases after the constraint had
 * stopped implying it.
 */
const BLOCKED_RENAMES: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Vendor mentions inside one string.
 * @param value The job name under test.
 * @returns Every denied word it contains, lowercased.
 */
const vendorsIn = (value: string): string[] =>
  VENDORS.filter(vendor => value.toLowerCase().includes(vendor));

/**
 * Every job in both workflows, as id and posted name.
 * @returns One entry per job.
 */
const allJobs = (): { job: string; name: string }[] =>
  WORKFLOWS.flatMap(file =>
    Object.entries(loadWorkflow(path.join(REPO_ROOT, file)).jobs).map(
      ([job, definition]) => ({
        job,
        name: String((definition as { name?: string }).name ?? ""),
      })
    )
  );

/**
 * Alphabetical order both sides of a comparison are put into.
 * @param left One job id.
 * @param right The other.
 * @returns Negative, zero or positive, per `localeCompare`.
 */
const byName = (left: string, right: string): number =>
  left.localeCompare(right);

describe("CI job names name properties, not vendors", () => {
  it("inspects every job in both reusable workflows", () => {
    // The enumeration is the control. `playwright_e2e_setup` escaped the
    // label suite because that one walks the registry, and a job with no gate
    // derives no label — so it was invisible to a check that starts from
    // gates and had to be found by reading the YAML.
    const jobs = allJobs();

    expect(jobs.length).toBeGreaterThan(30);
    for (const { job, name } of jobs) {
      expect(name, `${job} has no name:`).toBeTruthy();
    }
  });

  it("finds a vendor in no job name, and records no blocked rename", () => {
    const offenders = allJobs()
      .filter(({ name }) => vendorsIn(name).length > 0)
      .map(({ job }) => job)
      .sort(byName);

    expect(offenders).toEqual(Object.keys(BLOCKED_RENAMES).sort(byName));
  });

  it("holds every exemption to stating what blocks the rename", () => {
    // An exemption is only honest while it says why. This is what stopped the
    // survivors from becoming permanent by inattention, and it is kept with
    // the table empty so a re-added entry cannot arrive without its reason.
    // A loop rather than `it.each`, which has no cases to generate from an
    // empty table and errors at collection instead of reporting zero.
    for (const [job, reason] of Object.entries(BLOCKED_RENAMES)) {
      expect(reason.length, `${job} states no blocker`).toBeGreaterThan(80);
    }
  });

  it("keeps the second prover of dependency-vulnerability property-shaped", () => {
    // The last vendor-named job. It may never wear `🔒 Security Scan` — its
    // gate's label, carried by `npm_security_scan`, which is the job a ruleset
    // matches — so it takes the property it proves at the depth the ship-scope
    // audit does not reach. Asserted by exact string, because a job name IS a
    // branch-protection context and this has to fail on a rename rather than
    // follow one.
    const snyk = allJobs().find(({ job }) => job === "snyk");

    expect(snyk?.name).toBe("🛡️ Supply Chain Scan");
  });

  it("keeps the shard-fanout helper on a property-shaped name", () => {
    // The one this issue could actually fix: a shard-fanout helper with no
    // gate, so nothing derives a context from it — but it still posted a
    // check name naming a vendor, which is what the ruling is about.
    const setup = allJobs().find(({ job }) => job === "playwright_e2e_setup");

    expect(setup?.name).toBe("🎭 Journey Shard Setup");
  });
});
