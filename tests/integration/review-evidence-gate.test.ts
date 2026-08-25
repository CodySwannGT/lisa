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
 * OFFLINE arm, `required-checks-drift.yml` ran `--remote`, and the package
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
import { loadWorkflow } from "../helpers/workflow-test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Filename of the prover the gate runs. */
const SCRIPT_BASENAME = "check-skipped-required-checks.mjs";

/** Where the gate looks for an installed copy, relative to a repo root. */
const INSTALLED_RELATIVE = path.join("scripts", SCRIPT_BASENAME);

/** The in-repo template directory the gate falls back to. */
const TEMPLATE_DIR = path.join("typescript", "copy-overwrite", "scripts");

/** The per-repo reviewed snapshot the prover reads. */
const DECLARATION_RELATIVE = path.join(".github", "required-checks.json");

/** The workflow whose `skip_jobs` the declaration points the prover at. */
const CI_WORKFLOW = ".github/workflows/ci.yml";

/** The measured review context. */
const CODERABBIT = "CodeRabbit";

/** The measured hollow description — `success` while reviewing nothing. */
const RATE_LIMITED = "Review rate limited";

/** The measured description of a review that really happened. */
const REVIEWED = "Review completed";

/** Stable pull-request head returned by the GitHub CLI fixture. */
const HEAD_SHA = "a".repeat(40);

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/**
 * Extracts the gate's `run:` block from the shipped workflow.
 *
 * @returns The shell source GitHub Actions would execute for that step.
 */
function gateStepScript(): string {
  const workflow = loadWorkflow(
    path.join(REPO_ROOT, ".github", "workflows", "review-evidence.yml")
  );
  const step = (workflow.jobs?.vacuity?.steps ?? []).find(candidate =>
    candidate.run?.includes(SCRIPT_BASENAME)
  );
  const script = step?.run ?? "";

  expect(
    script,
    `review-evidence.yml job 'vacuity' must run ${SCRIPT_BASENAME}`
  ).toBeTruthy();

  return script;
}

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
    const payload = path.join(bindir, "checks.json");
    await fs.writeJson(payload, rows ?? []);
    const apiAnswer =
      rows === null ? "exit 1" : `cat ${JSON.stringify(payload)}`;
    await fs.writeFile(
      path.join(bindir, "gh"),
      `#!/bin/sh
case "$1:$2" in
  pr:view) printf '%s\n' ${JSON.stringify(HEAD_SHA)} ;;
  pr:checks) ${rows === null ? "exit 1" : `cat ${JSON.stringify(payload)}`} ;;
  api:*status*) ${apiAnswer} ;;
  api:*check-runs*) ${rows === null ? "exit 1" : "printf '%s\\n' '[]'"} ;;
  *) exit 1 ;;
esac
`,
      { mode: 0o755 }
    );
  }

  /**
   * Runs the gate step in the temp workdir.
   *
   * @param pr The pull request number the dispatch input names.
   * @returns Exit status and the step's combined output.
   */
  function runGate(pr = "1234"): { status: number; output: string } {
    const result = boundedSpawnSync({
      label: "the review-evidence gate step",
      command: BASH,
      args: ["-c", gateStepScript()],
      cwd: workdir,
      env: {
        ...process.env,
        PATH: `${bindir}${path.delimiter}${process.env.PATH ?? ""}`,
        VACUITY_PR: pr,
        GITHUB_REPOSITORY: "owner/name",
        GITHUB_EVENT_PATH: "",
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
   * Installs the REAL prover under `scripts/`, with the lib it imports.
   */
  async function installProver(): Promise<void> {
    await fs.ensureDir(path.join(workdir, "scripts"));
    await fs.copy(
      path.join(REPO_ROOT, TEMPLATE_DIR, "lib"),
      path.join(workdir, "scripts", "lib")
    );
    await fs.copy(
      path.join(REPO_ROOT, TEMPLATE_DIR, SCRIPT_BASENAME),
      path.join(workdir, INSTALLED_RELATIVE)
    );
  }

  /**
   * Writes a transcribed declaration naming CodeRabbit as evidence-bearing.
   */
  async function writeDeclaration(): Promise<void> {
    await fs.ensureDir(path.join(workdir, ".github", "workflows"));
    await fs.writeFile(
      path.join(workdir, CI_WORKFLOW),
      ["jobs:", "  quality:", "    with:", "      skip_jobs: ''", ""].join("\n")
    );
    await fs.writeJson(path.join(workdir, DECLARATION_RELATIVE), {
      ruleset: {
        repo: "owner/name",
        ids: [1],
        // Stamped NOW. An expired stamp makes the prover refuse rather than
        // answer, which would pass the failure cases for the wrong reason.
        baseline_fetched_at: new Date().toISOString().slice(0, 10),
      },
      workflows: [CI_WORKFLOW],
      required_contexts: [CODERABBIT],
      skip_job_declarations: {},
      evidence_bearing_checks: { [CODERABBIT]: {} },
    });
  }

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
        state: "SUCCESS",
        bucket: "pass",
        description: RATE_LIMITED,
      },
    ]);

    const { status, output } = runGate("3123");

    expect(output).toContain("vacuous_required_check");
    expect(output).toContain(RATE_LIMITED);
    expect(output).toContain("Treat this PR as UNREVIEWED");
    // Report-only by default: a review bot can go hollow on a BILLING state,
    // and reddening every pull request for that is a worse gate than this one.
    expect(status).toBe(0);
  });

  it("NEGATIVE CONTROL — says nothing about a review that really happened", async () => {
    // Without this case, a rule that flagged every check would satisfy every
    // other assertion in this file and still be pure noise.
    await installProver();
    await writeDeclaration();
    await stubGh([
      {
        name: CODERABBIT,
        state: "SUCCESS",
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
