/**
 * Proves the shipped `🕵️ Review Evidence` job BITES, refuses, and passes.
 *
 * The step is pulled verbatim out of the workflow and EXECUTED rather than
 * string-matched, for the same reason its sibling
 * `skipped-required-checks-gate-fail-closed.test.ts` is: the properties under
 * test are an exit code and a finding, and a test that greps the YAML passes
 * against a step whose `exit 1` sits on an unreachable branch — the same class
 * of bug as the one being fixed.
 *
 * WHAT THIS EXISTS FOR (CodySwannGT/lisa#2928). The `vacuous_required_check`
 * rule shipped in #2497 and nothing ever invoked it: `quality.yml` ran the
 * OFFLINE arm, a scheduled drift workflow ran its own arm, and the package
 * script named for the vacuous check was a bare invocation. Measured on the
 * repository that owns the rule, 23 of the last 25 merged pull requests carried
 * a REQUIRED `CodeRabbit` context reporting `success` with a description saying
 * it did no work, and nothing anywhere said so.
 *
 * Five cases, because "it runs" is not the claim. A planted hollow review is
 * REPORTED; a planted real review is NOT (without that control the rule would
 * be indistinguishable from one that flags everything); an unreadable `gh`
 * REFUSES rather than reporting all-clear; and both absent inputs fail closed.
 *
 * @module tests/integration/review-evidence-gate
 */

import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import {
  configureRegistrationReads,
  installReviewEvidenceProver,
  installReviewGh,
  reviewEvidenceStep,
  writeReviewDeclaration,
} from "../helpers/review-evidence-registration-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Filename of the prover the gate runs. */
const SCRIPT_BASENAME = "check-skipped-required-checks.mjs";

/** Where the gate looks for an installed copy, relative to a repo root. */
const INSTALLED_RELATIVE = path.join("scripts", SCRIPT_BASENAME);

/** The per-repo reviewed snapshot the prover reads. */
const DECLARATION_RELATIVE = path.join(".github", "required-checks.json");

/** A completed status returned by the external-read fixture. */
const SUCCESS = "SUCCESS";

/** The measured review context. */
const CODERABBIT = "CodeRabbit";

/** The measured hollow description — `success` while reviewing nothing. */
const RATE_LIMITED = "Review rate limited";

/** The measured description of a review that really happened. */
const REVIEWED = "Review completed";

/** The other measured entitlement wording — 29 of the 40 PRs read on #3221. */
const MANUAL_REQUIRED =
  "Review skipped: manual review required for this OSS repository";

/** Stable pull-request head returned by the GitHub CLI fixture. */
const HEAD_SHA = "a".repeat(40);

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

describe("🕵️ Review Evidence gate", () => {
  let workdir = "";
  let bindir = "";

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "review-evidence-"));
    bindir = await fs.mkdtemp(path.join(os.tmpdir(), "review-evidence-bin-"));
  });

  afterEach(async () => {
    await fs.remove(workdir);
    await fs.remove(bindir);
  });

  /**
   * Installs a `gh` on PATH that resolves one head and serves its check rows.
   *
   * @param rows The rows to print, or null to exit non-zero with empty stdout
   *   — which is exactly what a missing `actions: read` produces.
   */
  async function stubGh(
    rows: readonly Record<string, string>[] | null
  ): Promise<void> {
    await installReviewGh(bindir, rows, HEAD_SHA);
  }

  /**
   * Runs the gate step in the temp workdir.
   *
   * @param pr The pull request number the dispatch input names.
   * @param workflowPath Which actual workflow step to execute.
   * @returns Exit status and the step's combined output.
   */
  function runGate(
    pr = "1234",
    workflowPath?: string
  ): { status: number; output: string } {
    const result = boundedSpawnSync({
      label: "the review-evidence gate step",
      command: BASH,
      args: ["-c", reviewEvidenceStep(REPO_ROOT, workflowPath)],
      cwd: workdir,
      env: {
        ...process.env,
        PATH: `${bindir}${path.delimiter}${process.env.PATH ?? ""}`,
        VACUITY_PR: pr,
        GITHUB_REPOSITORY: "owner/name",
        GITHUB_BASE_REF: "main",
        NODE_OPTIONS: fs.existsSync(path.join(bindir, "clock.mjs"))
          ? `--import=${path.join(bindir, "clock.mjs")}`
          : (process.env.NODE_OPTIONS ?? ""),
        GITHUB_EVENT_PATH: fs.existsSync(path.join(bindir, "event.json"))
          ? path.join(bindir, "event.json")
          : "",
        GITHUB_REF: "",
        GITHUB_STEP_SUMMARY: "",
      },
    });
    return {
      status: result.status ?? -1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  }

  /**
   * Installs the real shipped prover and relative imports.
   * @returns Completion after the real source bytes are installed.
   */
  const installProver = () => installReviewEvidenceProver(REPO_ROOT, workdir);

  /**
   * Writes a fresh declaration with an exact required roster.
   * @param required The selected required roster.
   * @returns Completion after the declaration is written.
   */
  const writeDeclaration = (required = [CODERABBIT]) =>
    writeReviewDeclaration(workdir, required);

  /**
   * Controls external observations and the wait clock; the CLI is real.
   * @param laterName The later row, or null when required registration never occurs.
   * @param substitute Supply the all-reviewer substitute shortcut.
   * @param absentReviewer Leave the substituted reviewer entirely unreported.
   */
  async function registrationFixture(
    laterName: string | null,
    substitute = false,
    absentReviewer = false
  ): Promise<void> {
    await installProver();
    await writeDeclaration(absentReviewer ? ["Lint"] : [CODERABBIT, "Lint"]);
    await stubGh(
      absentReviewer
        ? []
        : [
            {
              name: CODERABBIT,
              state: SUCCESS,
              description: substitute ? RATE_LIMITED : REVIEWED,
            },
          ]
    );
    await configureRegistrationReads(
      bindir,
      laterName,
      substitute,
      absentReviewer
    );
  }

  describe.each([
    ".github/workflows/review-evidence.yml",
    "typescript/create-only/.github/workflows/review-evidence.yml",
  ])("real preflight and verdict diagnostics: %s", workflowPath => {
    it("the actual armed CLI observes delayed required registration before judging absence", async () => {
      await registrationFixture("Lint");
      const run = runGate("1234", workflowPath);
      expect(run.status).toBe(0);
      expect(run.output).not.toContain("absent_required_check");
      expect(run.output).toContain("2 of 2 required contexts observed");
      expect(run.output).toContain("after 15s");
    });

    it("the actual armed CLI keeps unrelated registration waiting with every reviewer substituted", async () => {
      await registrationFixture("Lint", true);
      const run = runGate("1234", workflowPath);
      expect(run.status).toBe(0);
      expect(run.output).toContain("SUBSTITUTED");
      expect(run.output).toContain("after 15s");
      expect(run.output).not.toContain("absent_required_check");
    });

    it("does not claim a review wait expired when an absent reviewer is substituted and registration succeeds", async () => {
      await registrationFixture("Lint", true, true);
      const run = runGate("1234", workflowPath);
      expect(run.status).toBe(0);
      expect(run.output).toContain("covered by head-bound substitutes");
      expect(run.output).toContain(
        "per-branch set for base 'main' (1 contexts)"
      );
      expect(run.output).not.toMatch(/wait expired/iu);
    });

    it.each([null, "Renamed Lint"])(
      "the actual armed CLI refuses missing/renamed registration (%s) after one ceiling",
      async laterName => {
        await registrationFixture(laterName);
        const run = runGate("1234", workflowPath);
        expect(run.status).toBe(1);
        expect(run.output).toContain("stopped waiting after 300s");
        expect(run.output).toContain("1 of 2 required contexts observed");
        expect(run.output).toContain("Lint");
        expect(run.output).toContain("RE-RUN");
        expect(run.output).not.toContain("not failing, ABSENT");
      }
    );

    it("does not echo ready-made missing-file annotations when both inputs exist", async () => {
      await installProver();
      await writeDeclaration();
      await stubGh([
        { name: CODERABBIT, state: SUCCESS, description: REVIEWED },
      ]);
      const run = runGate("1234", workflowPath);
      expect(run.status).toBe(0);
      const echoedAndExecuted = `${reviewEvidenceStep(REPO_ROOT, workflowPath)}\n${run.output}`;
      expect(echoedAndExecuted).not.toContain(
        "::error title=Vacuity prover missing::"
      );
      expect(echoedAndExecuted).not.toContain(
        "::error title=Required-checks declaration missing::"
      );
    });

    it.each(["prover", "declaration"])(
      "emits a real error only when the %s input is missing",
      async missing => {
        if (missing === "declaration") await installProver();
        else await writeDeclaration();
        const run = runGate("1234", workflowPath);
        expect(run.status).not.toBe(0);
        expect(run.output).toContain(
          missing === "prover"
            ? "::error title=Vacuity prover missing::"
            : "::error title=Required-checks declaration missing::"
        );
      }
    );

    it("makes the first actual error summarize a real failed verdict before details", async () => {
      await installProver();
      await writeDeclaration();
      await stubGh([
        { name: CODERABBIT, state: SUCCESS, description: "Review deferred" },
      ]);
      const run = runGate("1234", workflowPath);
      expect(run.status).toBe(1);
      const errors = run.output
        .split("\n")
        .filter(line => line.startsWith("::error"));
      expect(errors[0]).toMatch(
        /title=Required checks verdict::.*review_evidence_unsatisfied/u
      );
      expect(errors.length).toBeGreaterThan(1);
    });
  });

  it("fails when the prover is absent from BOTH resolution paths", async () => {
    await stubGh([]);
    const { status, output } = runGate();

    expect(status).not.toBe(0);
    expect(output).toContain("::error");
    expect(output).toContain(INSTALLED_RELATIVE);
  });

  it("fails when the prover resolves but the declaration is absent", async () => {
    await stubGh([]);
    await installProver();

    const { status, output } = runGate();

    expect(status).not.toBe(0);
    expect(output).toContain("::error");
    expect(output).toContain(DECLARATION_RELATIVE);
  });

  it("REPORTS a required check that reported success having reviewed nothing", async () => {
    // The gate BITING. `gh pr checks` prints `pass` for this exactly as it does
    // for a real review — only the description tells them apart.
    await installProver();
    await writeDeclaration();
    await stubGh([
      {
        name: CODERABBIT,
        state: SUCCESS,
        bucket: "pass",
        description: RATE_LIMITED,
      },
    ]);

    const { status, output } = runGate("3123");

    expect(output).toContain("vacuous_required_check");
    expect(output).toContain(RATE_LIMITED);
    // The finding still fires and still names the description; it no longer
    // instructs a conclusion `Review rate limited` cannot support
    // (CodySwannGT/lisa#3762), and points at what settles it instead.
    expect(output).not.toMatch(/treat this pr as unreviewed/iu);
    expect(output).toContain("reviewThreads");
    // Exit 0, and the reason is now the WAIVER rather than report-only. The
    // owner's ruling (CodySwannGT/lisa#3221) waives the two descriptions in
    // which the check says, in its own words, that it could not review — both
    // trace to one free-OSS entitlement no pull request author can act on, and
    // reddening every PR on a vendor billing state is a worse gate than this
    // one. The finding is still emitted in full; only the exit code differs.
    expect(output).toContain("review_evidence_waived");
    expect(status).toBe(0);
  });

  it("WAIVES the other measured entitlement string the same way", async () => {
    // 29 of the 40 merged pull requests read on #3221 carried this one, against
    // 10 for the rate-limit wording. One condition reported two ways: the bot
    // claims `Plan: Pro Plus` while saying the free OSS reviews are exhausted.
    await installProver();
    await writeDeclaration();
    await stubGh([
      {
        name: CODERABBIT,
        state: SUCCESS,
        bucket: "pass",
        description: MANUAL_REQUIRED,
      },
    ]);

    const { status, output } = runGate("3215");

    expect(output).toContain("review_evidence_waived");
    expect(output).toContain("UNREVIEWED");
    expect(status).toBe(0);
  });

  it("BLOCKS a review that ran and OBJECTED", async () => {
    // The case the whole gate exists for, and the one with no live example in
    // this repository — which is exactly why it is exercised end to end rather
    // than assumed. No waiver covers it.
    await installProver();
    await writeDeclaration();
    await stubGh([
      {
        name: CODERABBIT,
        state: "FAILURE",
        bucket: "fail",
        description: "Review completed with blocking issues",
      },
    ]);

    const { status, output } = runGate("4001");

    expect(output).toContain("review_evidence_unsatisfied");
    expect(output).toContain("RAN AND OBJECTED");
    expect(status).not.toBe(0);
  });

  it("BLOCKS an unrecognised description rather than waiving it", async () => {
    // A gate that waived on "anything that is not a completed review" would
    // waive every phrase the vendor has not invented yet. Unrecognised
    // surfaces; widening the waiver is a deliberate, named act.
    await installProver();
    await writeDeclaration();
    await stubGh([
      {
        name: CODERABBIT,
        state: SUCCESS,
        bucket: "pass",
        description: "Review deferred pending vendor maintenance",
      },
    ]);

    const { status, output } = runGate("4002");

    expect(output).toContain("review_evidence_unsatisfied");
    expect(output).toContain("UNRECOGNISED");
    expect(status).not.toBe(0);
  });

  // The ABSENT state is exercised in `vacuous-required-checks-wiring`, not
  // here, and the reason is a real property rather than convenience:
  // `checksSettled` returns false for a declared check that has not reported,
  // so an absent one is re-read until the settle window expires — 300s by
  // default. That is correct in production (a check that has not posted YET is
  // not the same as one that will never post), and it means this step cannot
  // reach the absent verdict inside a test budget. The wiring suite drives the
  // same code path with `--settle-timeout=0`.

  it("NEGATIVE CONTROL — says nothing about a review that really happened", async () => {
    // Without this case, a rule that flagged every check would satisfy every
    // other assertion in this file and still be pure noise.
    await installProver();
    await writeDeclaration();
    await stubGh([
      {
        name: CODERABBIT,
        state: SUCCESS,
        bucket: "pass",
        description: REVIEWED,
      },
    ]);

    const { status, output } = runGate("3091");

    expect(status).toBe(0);
    expect(output).not.toContain("vacuous_required_check");
    expect(output).toContain("evidence-bearing check(s) examined");
  });

  it("REFUSES rather than reporting all-clear when it could not read the checks", async () => {
    // A red run here means NOBODY LOOKED, which is a different fact from "the
    // review was hollow" — and the token in the output is what says which.
    await installProver();
    await writeDeclaration();
    await stubGh(null);

    const { status, output } = runGate();

    expect(status).not.toBe(0);
    expect(output).toContain("NOT INSPECTED");
    expect(output).toContain("vacuity_checks_unreadable");
    expect(output).not.toContain("evidence-bearing check(s) examined");
  });
});
