/**
 * Proves a failing `--strict` security-floor run FAILS its workflow step.
 *
 * It did not. The step was
 *
 * ```
 * node scripts/check-security-floors.mjs --strict | tee -a "$GITHUB_STEP_SUMMARY"
 * ```
 *
 * and GitHub's default shell for `run:` is `bash -e {0}` — `-e` but no
 * `pipefail` — so the step's exit status was `tee`'s, which is always 0. All
 * three conditions `--strict` exists to raise were discarded: a floor below a
 * live advisory, an inconclusive or rate-limited run, and an unresolved
 * `$name`. Measured:
 *
 * ```
 * bash -e             -c 'node -e "process.exit(1)" | tee /dev/null' -> 0
 * bash -e -o pipefail -c 'node -e "process.exit(1)" | tee /dev/null' -> 1
 * ```
 *
 * The step is pulled verbatim out of the workflow and EXECUTED here, under the
 * same `bash -e` GitHub uses. A test asserting the workflow text contains
 * `pipefail` would pass without the gate working — that exact pattern, a
 * wiring test that string-matched the YAML, passed for the entire period a
 * neighbouring gate never ran. A workflow that mentions a command is not a
 * workflow that reaches it.
 *
 * Every case asserting an exit STATUS is offline. A manifest whose only entry
 * is a `$name` pointing at nothing — or a floor with no readable lower bound —
 * produces a strict failure with zero advisory lookups, so the bite does not
 * depend on the network or on a live advisory. The one case that does reach
 * the network asserts only on report content decided before the first request.
 *
 * @module tests/integration/security-floors-gate
 */

import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { loadWorkflow } from "../helpers/workflow-test-utils.js";

// The bounded children below are handed a base that only fits under a case
// budget scaling with the same machine they do. Without this call the case
// budget is the flat one from `vitest.config.local.ts`, and the child's bound
// overtakes it from a slowdown of 4.0x up — a range measured on this box, in
// this tree, in the run that fixed CodySwannGT/lisa#3202.
useIoLatencyBudget();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The workflow under test. */
const WORKFLOW = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "security-floors.yml"
);

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** The job whose one substantive step is under test. */
const JOB_ID = "security-floors";

/** The script the step runs, relative to a repo root. */
const SCRIPT_RELATIVE = path.join("scripts", "check-security-floors.mjs");

/** The governance root manifest's repo-relative path. */
const ROOT_MANIFEST = "package.lisa.json";

/** Where Lisa keeps that script. */
const SCRIPT_SOURCE = path.join(REPO_ROOT, SCRIPT_RELATIVE);

/** The shared modules the prover imports relative to itself. */
const SCRIPT_LIB_SOURCE = path.join(REPO_ROOT, "scripts", "lib");

/**
 * The audit step's shell source.
 * @returns What GitHub Actions would execute.
 */
function auditStepScript(): string {
  const workflow = loadWorkflow(WORKFLOW);
  const job = workflow.jobs[JOB_ID];
  const step = (job?.steps ?? []).find(candidate =>
    candidate.run?.includes("check-security-floors.mjs")
  );
  const script = step?.run ?? "";

  expect(
    script,
    `${path.basename(WORKFLOW)} job '${JOB_ID}' must run the floor check`
  ).toBeTruthy();

  return script;
}

describe("🔒 security-floor audit step", () => {
  let workdir = "";
  let summary = "";

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "floors-gate-"));
    summary = path.join(workdir, "step-summary.md");
    await fs.writeFile(summary, "");
    await fs.ensureDir(path.join(workdir, "scripts"));
    await fs.copy(SCRIPT_SOURCE, path.join(workdir, SCRIPT_RELATIVE));
    // The whole `lib/` beside it, not a named file. The prover imports shared
    // siblings, and a fixture that vendors them by name silently stops being
    // runnable the moment one is added — the failure then reads as the gate
    // refusing rather than the fixture being incomplete
    // (CodySwannGT/lisa#2980).
    await fs.copy(SCRIPT_LIB_SOURCE, path.join(workdir, "scripts", "lib"));
  });

  afterEach(async () => {
    await fs.remove(workdir);
  });

  /**
   * Writes a manifest whose only floor is a self-reference to nothing.
   *
   * `--strict` fails on an unresolved `$name` for the same reason it fails on
   * a rate-limited lookup: it is a floor nobody checked. Nothing resolvable is
   * declared, so the audit makes no network calls at all.
   * @param at Repo-relative path for the manifest.
   */
  async function writeFailingManifest(at: string): Promise<void> {
    await fs.ensureDir(path.dirname(path.join(workdir, at)));
    await fs.writeJson(path.join(workdir, at), {
      force: { overrides: { "some-package": "$some-package" } },
    });
  }

  /**
   * Runs the step exactly as GitHub Actions would.
   *
   * `bash -e`, deliberately: that is the default shell, and running it under
   * anything stricter would prove a property the real job does not have.
   * @returns Exit status, combined output, and the job summary written.
   */
  function runStep(): { status: number; output: string; summary: string } {
    const result = boundedSpawnSync({
      label: "the security-floors audit step",
      command: BASH,
      args: ["-e", "-c", auditStepScript()],
      // The step walks every manifest in the tree.
      baseMs: 30_000,
      cwd: workdir,
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    });
    return {
      status: result.status ?? -1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      summary: fs.readFileSync(summary, "utf8"),
    };
  }

  it("fails the step when the strict run fails", async () => {
    // The bite. Pre-fix this returned 0: the pipeline reported `tee`'s status.
    await writeFailingManifest(
      path.join("typescript", "package-lisa", ROOT_MANIFEST)
    );

    const { status, summary: written } = runStep();

    expect(status).not.toBe(0);
    // And it still reports: failing loudly must not cost the job summary.
    expect(written).toContain("Security floors");
  });

  it("fails the step when the ROOT manifest is the one that fails", async () => {
    // The root manifest was outside the glob entirely, so a failure declared
    // there could not fail anything — two defects compounding.
    await writeFailingManifest(ROOT_MANIFEST);

    const { status, summary: written } = runStep();

    expect(status).not.toBe(0);
    expect(written).toContain("self-reference");
  });

  it("fails the step when a floor has no readable lower bound", async () => {
    // lisa#3438. `<8.0.0` is a ceiling, not a floor: it permits every earlier
    // release, vulnerable ones included. It used to be dropped by
    // `if (!lowest) continue` and the run reported a clean sheet.
    //
    // Offline like the others: a floor with no lower bound is detected while
    // the manifests are read, so no advisory lookup happens at all — which is
    // also what makes it visible on a run that is entirely rate-limited.
    await fs.ensureDir(path.dirname(path.join(workdir, ROOT_MANIFEST)));
    await fs.writeJson(path.join(workdir, ROOT_MANIFEST), {
      force: { overrides: { "some-package": "<8.0.0" } },
    });

    const { status, summary: written } = runStep();

    expect(status).not.toBe(0);
    expect(written).toContain("could NOT be checked");
    expect(written).toContain("some-package");
    // The reason, not just the fact. An operator has to know what to fix.
    expect(written).toContain("upper bound");
  });

  it("does not report a caret floor as unchecked", async () => {
    // The other half of the same fix. `^8` used to resolve to null and be
    // skipped; it now resolves to 8.0.0, so it is a floor the audit compares
    // rather than one it reports as unchecked.
    //
    // Asserts the unchecked block's ABSENCE and not the exit status, which is
    // what keeps this case as offline as its neighbours: a caret floor does
    // reach the advisory lookup, and on a machine with no network that lookup
    // lands in `unreachable` and fails `--strict` for a reason unrelated to
    // this test. Whether the floor was read is decided before the first
    // request either way, so that is what is pinned.
    await fs.writeJson(path.join(workdir, ROOT_MANIFEST), {
      force: { overrides: { "some-package": "^8" } },
    });

    const { summary: written } = runStep();

    expect(written).not.toContain("could NOT be checked");
  });

  it("passes the step when there is nothing to report", async () => {
    // The other direction: a clean repository must stay green, and the report
    // must still reach the job summary through the pipe.
    await fs.writeJson(path.join(workdir, ROOT_MANIFEST), {
      force: { overrides: {} },
    });

    const { status, summary: written } = runStep();

    expect(status).toBe(0);
    expect(written).toContain("Security floors");
  });

  it("would have passed without pipefail, which is the defect", () => {
    // Pins the mechanism rather than the spelling. If someone removes
    // `set -o pipefail` the first test goes red; this one explains why.
    const withoutPipefail = boundedSpawnSync({
      label: "bash -e without pipefail",
      command: BASH,
      args: ["-e", "-c", 'node -e "process.exit(1)" | tee /dev/null'],
      cwd: workdir,
    });
    const withPipefail = boundedSpawnSync({
      label: "bash -e -o pipefail",
      command: BASH,
      args: [
        "-e",
        "-o",
        "pipefail",
        "-c",
        'node -e "process.exit(1)" | tee /dev/null',
      ],
      cwd: workdir,
    });

    expect(withoutPipefail.status).toBe(0);
    expect(withPipefail.status).not.toBe(0);
  });

  it("starts the job when the governance root manifest changes", () => {
    // A gate that cannot be triggered by the file it governs is not watching
    // that file. The `paths:` filter carried the same one-level glob.
    const workflow = loadWorkflow(WORKFLOW);
    const paths = workflow.on?.pull_request?.paths ?? [];

    expect(paths).toContain(ROOT_MANIFEST);
    expect(paths).toContain(`*/package-lisa/${ROOT_MANIFEST}`);
  });
});
