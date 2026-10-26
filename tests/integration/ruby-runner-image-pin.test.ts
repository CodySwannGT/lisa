/**
 * Every job that installs a Ruby Lisa names runs, for Lisa, on a fixed image
 * (CodySwannGT/lisa#4513).
 *
 * `ruby/setup-ruby` publishes prebuilt Rubies per runner image. In October
 * 2026 GitHub moved `ubuntu-latest` to the 26.04 image, which has no 4.0.1
 * build, and every pull request's Integration Tests failed at setup:
 * "Unavailable version 4.0.1 for ruby on ubuntu-26.04". A job whose
 * setup-ruby step names an explicit `ruby-version` (including expressions)
 * has to run on an image that version is published for.
 *
 * Two forms pass: a bare `ubuntu-NN.NN`, and, for a job in a reusable
 * workflow consumers also call, a conditional that resolves to a fixed
 * `ubuntu-NN.NN` in Lisa's own repository and leaves callers on their image.
 * Bare `ubuntu-latest`, any other expression and label lists fail.
 *
 * Out of scope here: `quality-rails.yml`'s setup-ruby jobs, which take the
 * caller's `.ruby-version` but hardcode `ubuntu-latest`. Their image is still
 * Lisa's choice, and that defect is tracked in CodySwannGT/lisa#4517. Jobs are
 * found by their steps rather than listed by name, so a new job that names a
 * Ruby inherits the rule.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  loadWorkflow,
  type ParsedWorkflow,
  type WorkflowStep,
} from "../helpers/workflow-test-utils.js";

const WORKFLOWS = path.resolve(__dirname, "..", "..", ".github", "workflows");

/** A fixed GitHub-hosted Ubuntu image, e.g. ubuntu-24.04. */
const FIXED_IMAGE = /^ubuntu-\d{2}\.\d{2}$/;

/**
 * The one accepted expression: Lisa's repository gets a fixed image, every
 * caller of the reusable workflow keeps the image it names.
 */
const LISA_CONDITIONAL =
  /^\$\{\{\s*github\.repository\s*==\s*'CodySwannGT\/lisa'\s*&&\s*'([^']+)'\s*\|\|\s*'[^']+'\s*\}\}$/;

/** A job as the guard reads it. */
interface RubyJob {
  readonly workflow: string;
  readonly job: string;
  readonly runsOn: unknown;
  /** The `if:` of each setup-ruby step in the job, or undefined when ungated. */
  readonly rubyStepIfs: readonly (string | undefined)[];
}

/** The repository a `github.repository == '...'` comparison names. */
const REPOSITORY_COMPARISON = /github\.repository\s*==\s*'([^']+)'/;

/**
 * A setup-ruby `if:` that is exactly one repository comparison, once the
 * optional `${{ }}` wrapper and surrounding whitespace are removed.
 */
const LISA_ONLY_GATE = /^github\.repository\s*==\s*'([^']+)'$/;

/** An optional `${{ ... }}` wrapper around a whole condition. */
const EXPRESSION_WRAPPER = /^\$\{\{([\s\S]*)\}\}$/;

/**
 * The repository a setup-ruby step's `if:` restricts it to, or undefined
 * when the condition is anything but exactly that one comparison.
 *
 * The WHOLE condition must match, not just contain the comparison: a
 * broadened `... || true` or `... || github.event_name == 'pull_request'`
 * still contains it, and would run setup-ruby for callers again.
 * @param gate - The step's `if:` value
 * @returns The repository, or undefined
 */
function lisaOnlyGateRepo(gate: unknown): string | undefined {
  if (typeof gate !== "string") return undefined;
  const trimmed = gate.trim();
  const unwrapped = (EXPRESSION_WRAPPER.exec(trimmed)?.[1] ?? trimmed).trim();
  return LISA_ONLY_GATE.exec(unwrapped)?.[1];
}

/**
 * The image a runs-on value gives Lisa's own runs, or undefined when it does
 * not give Lisa a fixed one.
 * @param runsOn - The job's runs-on value
 * @returns The fixed image, or undefined
 */
function lisaImage(runsOn: unknown): string | undefined {
  if (typeof runsOn !== "string") return undefined;
  if (FIXED_IMAGE.test(runsOn)) return runsOn;
  const lisa = LISA_CONDITIONAL.exec(runsOn)?.[1];
  return lisa !== undefined && FIXED_IMAGE.test(lisa) ? lisa : undefined;
}

/**
 * Every job whose setup-ruby step names an explicit ruby-version.
 * @returns The jobs, with their runs-on
 */
function jobsNamingRuby(): RubyJob[] {
  return fs
    .readdirSync(WORKFLOWS)
    .filter(file => /\.ya?ml$/.test(file))
    .flatMap(workflow => {
      const doc = loadWorkflow(path.join(WORKFLOWS, workflow)) as
        | ParsedWorkflow
        | undefined;
      return Object.entries(doc?.jobs ?? {}).flatMap(([job, body]) => {
        const steps = ((body as { steps?: WorkflowStep[] }).steps ??
          []) as WorkflowStep[];
        const names = steps.some(
          step =>
            String(step.uses ?? "").startsWith("ruby/setup-ruby") &&
            step.with?.["ruby-version"] !== undefined
        );
        const rubyStepIfs = steps
          .filter(step => String(step.uses ?? "").startsWith("ruby/setup-ruby"))
          .map(step => step.if);
        return names
          ? [
              {
                workflow,
                job,
                runsOn: (body as { "runs-on"?: unknown })["runs-on"],
                rubyStepIfs,
              },
            ]
          : [];
      });
    });
}

describe("jobs that name a Ruby pin Lisa's runner image", () => {
  it("finds the Lisa-owned Ruby jobs, including the integration job", () => {
    expect(
      jobsNamingRuby().map(({ workflow, job }) => `${workflow}:${job}`)
    ).toEqual(
      expect.arrayContaining([
        "quality.yml:test_integration",
        "plugins-sync.yml:guard-trace",
      ])
    );
  });

  it.each(
    jobsNamingRuby().map(entry => [`${entry.workflow}:${entry.job}`, entry])
  )("%s runs on a fixed image for Lisa", (_name, entry) => {
    expect(lisaImage(entry.runsOn), String(entry.runsOn)).toMatch(FIXED_IMAGE);
  });

  it("leaves callers of the reusable quality workflow on their own image", () => {
    const integration = jobsNamingRuby().find(
      ({ workflow, job }) =>
        workflow === "quality.yml" && job === "test_integration"
    );
    expect(String(integration?.runsOn)).toMatch(LISA_CONDITIONAL);
    expect(String(integration?.runsOn)).toContain("|| 'ubuntu-latest'");
    // The image is only safe for callers because the Ruby step never runs
    // for them: without its gate, every caller would install Ruby 4.0.1 on
    // ubuntu-latest again. Each setup-ruby step must name the repository the
    // runs-on conditional pins.
    const pinnedRepo = REPOSITORY_COMPARISON.exec(
      String(integration?.runsOn)
    )?.[1];
    expect(pinnedRepo).toBe("CodySwannGT/lisa");
    expect(integration?.rubyStepIfs.length).toBeGreaterThan(0);
    for (const gate of integration?.rubyStepIfs ?? [])
      expect(lisaOnlyGateRepo(gate), String(gate)).toBe(pinnedRepo);
  });
});

/** The repository Lisa's conditional runs-on pins. */
const LISA_REPO = "CodySwannGT/lisa";

describe("the setup-ruby gate classifier", () => {
  it.each([
    ["the bare comparison", "github.repository == 'CodySwannGT/lisa'"],
    [
      "the comparison wrapped in an expression",
      "${{ github.repository == 'CodySwannGT/lisa' }}",
    ],
    [
      "the comparison with extra whitespace",
      "  ${{github.repository   ==   'CodySwannGT/lisa'}}  ",
    ],
  ])("accepts %s", (_label, gate) => {
    expect(lisaOnlyGateRepo(gate)).toBe(LISA_REPO);
  });

  // Mutants of the real step's `if:`. Each one would run setup-ruby for at
  // least some callers of the reusable workflow, which is the regression the
  // gate exists to prevent, so each must be rejected.
  it.each([
    ["no gate", undefined],
    ["an empty gate", ""],
    ["`|| true`", "${{ github.repository == 'CodySwannGT/lisa' || true }}"],
    [
      "`|| github.event_name == 'pull_request'`",
      "github.repository == 'CodySwannGT/lisa' || github.event_name == 'pull_request'",
    ],
    ["a negation with `!`", "!(github.repository == 'CodySwannGT/lisa')"],
    ["a negation with `!=`", "github.repository != 'CodySwannGT/lisa'"],
    ["another repository", "github.repository == 'someone/else'"],
    [
      "a trailing extra condition",
      "github.repository == 'CodySwannGT/lisa' && always()",
    ],
  ])("rejects %s", (_label, gate) => {
    expect(lisaOnlyGateRepo(gate)).not.toBe(LISA_REPO);
  });
});

/** The image Lisa's Ruby jobs pin today. */
const PINNED = "ubuntu-24.04";

describe("the runs-on classifier", () => {
  it.each([
    ["a bare fixed image", PINNED, PINNED],
    [
      "Lisa's conditional with a fixed image",
      "${{ github.repository == 'CodySwannGT/lisa' && 'ubuntu-24.04' || 'ubuntu-latest' }}",
      PINNED,
    ],
  ])("accepts %s", (_label, runsOn, image) => {
    expect(lisaImage(runsOn)).toBe(image);
  });

  it.each([
    ["bare ubuntu-latest", "ubuntu-latest"],
    [
      "the conditional with ubuntu-latest in Lisa's branch",
      "${{ github.repository == 'CodySwannGT/lisa' && 'ubuntu-latest' || 'ubuntu-24.04' }}",
    ],
    ["another expression", "${{ inputs.runner }}"],
    [
      "a conditional on another repository",
      "${{ github.repository == 'someone/else' && 'ubuntu-24.04' || 'ubuntu-latest' }}",
    ],
    ["a label list", ["self-hosted", "linux"]],
    ["a missing runs-on", undefined],
  ])("rejects %s", (_label, runsOn) => {
    expect(lisaImage(runsOn)).toBeUndefined();
  });
});
