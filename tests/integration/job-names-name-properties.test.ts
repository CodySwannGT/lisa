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
 * Recorded rather than renamed, and derived-and-compared in both directions
 * below so the set cannot grow in silence and an entry cannot outlive its
 * blocker. Neither is a required context on this repository's ruleset, so
 * neither blocks a merge today — which is exactly why they can wait for the
 * rulings they depend on rather than being renamed under time pressure.
 */
const BLOCKED_RENAMES: Readonly<Record<string, string>> = Object.freeze({
  snyk:
    "Cannot take its gate's label. `dependency-vulnerability` is labelled " +
    "🔒 Security Scan and `npm_security_scan` already posts that exact " +
    "string as a REQUIRED context here, so renaming would have two jobs post " +
    "one name. That is the two-provers-one-gate problem, and which job " +
    "carries the derived context is a ruling this issue does not make.",
  zap_baseline:
    "Its label already ships — `runtime-web-vulnerability` is 🕷️ DAST " +
    "Baseline — but that gate's legal moments are deploy-only while the job " +
    "runs at pull-request. Renaming alone would leave the mismatch unfixed " +
    "in the other direction; the moments are #2832's.",
});

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

  it("finds a vendor in no job name except the two with a recorded blocker", () => {
    const offenders = allJobs()
      .filter(({ name }) => vendorsIn(name).length > 0)
      .map(({ job }) => job)
      .sort(byName);

    expect(offenders).toEqual(Object.keys(BLOCKED_RENAMES).sort(byName));
  });

  it.each(Object.entries(BLOCKED_RENAMES))(
    "%s's exemption states what blocks the rename",
    (_job, reason) => {
      // An exemption is only honest while it says why. This is what stops the
      // two survivors from becoming permanent by inattention.
      expect(reason.length).toBeGreaterThan(80);
    }
  );

  it("keeps the shard-fanout helper on a property-shaped name", () => {
    // The one this issue could actually fix: a shard-fanout helper with no
    // gate, so nothing derives a context from it — but it still posted a
    // check name naming a vendor, which is what the ruling is about.
    const setup = allJobs().find(({ job }) => job === "playwright_e2e_setup");

    expect(setup?.name).toBe("🎭 Journey Shard Setup");
  });
});
