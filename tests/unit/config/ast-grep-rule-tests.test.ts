/**
 * Proof that `ast-grep/rule-tests/` is executed rather than merely present.
 *
 * The directory shipped six rule tests and six snapshots that no script, hook,
 * or CI job ever invoked, so they could not fail and could not pass — they only
 * looked like coverage. These tests pin the three properties that keep them
 * honest: the shipped rule tests actually run and pass here, the runner
 * genuinely reports failure when a rule test is wrong, and the CI wiring that
 * invokes it is gated on test files existing, so a project with none gets a
 * warning instead of a green step that measured nothing.
 *
 * A fourth property was added after the CI step took the fleet down: it must
 * be self-sufficient. Gating it on a `sg:test` script the host project has to
 * supply produced first a hard failure in every unpinned consumer and then,
 * once that was patched, a step that reported success having run nothing. The
 * last describe block executes the shipped step body against real project
 * trees so both of those regressions are caught here rather than in CI.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { load as loadYaml } from "js-yaml";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

// The bounded children below are handed a base that only fits under a case
// budget scaling with the same machine they do. Without this call the case
// budget is the flat one from `vitest.config.local.ts`, and the child's bound
// overtakes it from a slowdown of 4.0x up — a range measured on this box, in
// this tree, in the run that fixed CodySwannGT/lisa#3202.
useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
/** Where a package manager puts executables, in this repo and in a consumer. */
const LOCAL_BIN_DIR = "node_modules/.bin";
const AST_GREP = path.join(REPO_ROOT, LOCAL_BIN_DIR, "ast-grep");
/** The TypeScript-family reusable workflow these tests assert on. */
const TS_QUALITY_WORKFLOW = ".github/workflows/quality.yml";
const RULE_TESTS_DIR = "ast-grep/rule-tests";
const RULE_TEST_SCRIPT = "sg:test";
const SCAN_BIN = "ast-grep scan";
const RULE_TEST_BIN = "ast-grep test";
/**
 * The rule-test invocation, distinguished from the skip notice's remediation
 * text, which also names `ast-grep test`. Matching loosely would let the
 * notice stand in for the invocation.
 */
const RULE_TEST_INVOCATION = `${LOCAL_BIN_DIR}/${RULE_TEST_BIN}`;
/** The CLI the step falls back to when the project has not installed one. */
const PINNED_CLI = "@ast-grep/cli@0.40.4";
const RULE_TEST_GATE =
  "steps.check_rule_tests.outputs.has_rule_tests == 'true'";

/**
 * ast-grep colours its own PASS/FAIL labels and honours no flag or environment
 * variable that turns it off, so assertions have to read past the escapes.
 * Built at runtime because a literal escape byte in a regex is itself a lint
 * error.
 */
const ANSI_PATTERN = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;]*m`, "gu");

/** Manifests that force the ast-grep scripts onto a host project. */
const MANIFESTS_FORCING_AST_GREP = [
  "package.lisa.json",
  "typescript/package-lisa/package.lisa.json",
  "phaser/package-lisa/package.lisa.json",
  "harper-fabric/package-lisa/package.lisa.json",
] as const;

/**
 * Absolute, so the interpreter is not resolved through a writeable PATH.
 * GitHub-hosted runners and every developer machine ship bash here.
 */
const BASH = "/bin/bash";

/** ast-grep's root config file name. */
const SGCONFIG = "sgconfig.yml";

/** Every sgconfig that declares a rule-test directory. */
const SGCONFIGS = [
  SGCONFIG,
  `typescript/copy-overwrite/${SGCONFIG}`,
  `rails/copy-overwrite/${SGCONFIG}`,
  `phaser/copy-overwrite/${SGCONFIG}`,
] as const;

/** One workflow step, narrowed to the fields these tests assert on. */
type WorkflowStep = {
  readonly name?: string;
  readonly if?: string;
  readonly run?: string;
  readonly id?: string;
};

/**
 * Read a repository file as UTF-8 text.
 * @param relativePath - Path relative to the repository root
 * @returns File contents
 */
function readText(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
}

/**
 * Count the rule-test files ast-grep will discover in a test directory.
 *
 * Discovery is not suffix-based: ast-grep loads every YAML document directly
 * inside `testDir` and binds it to a rule by its `id`, so `__snapshots__` (a
 * subdirectory) and `.gitkeep` (not YAML) are the only things excluded. CI
 * counts the same way, which is what lets a zero count be reported as a skip
 * instead of a pass.
 * @param absoluteDir - Directory to count
 * @returns Number of discoverable rule-test files
 */
function countRuleTestFiles(absoluteDir: string): number {
  return fs
    .readdirSync(absoluteDir, { withFileTypes: true })
    .filter(
      entry =>
        entry.isFile() &&
        (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))
    ).length;
}

/**
 * Run `ast-grep test` against a config file.
 * @param configPath - Absolute path to an sgconfig.yml
 * @returns Exit status and de-coloured output
 */
function runRuleTests(configPath: string): {
  readonly status: number | null;
  readonly output: string;
} {
  const result = boundedSpawnSync({
    label: "ast-grep test",
    command: AST_GREP,
    args: ["test", "--config", configPath],
    cwd: REPO_ROOT,
    baseMs: 30_000,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.replace(
      ANSI_PATTERN,
      ""
    ),
  };
}

/**
 * Build a scratch project shaped like a real consumer that has NOT yet run
 * `lisa apply`: ast-grep config and rule tests present, `sg:test` absent from
 * package.json, and `@ast-grep/cli` installed as a dependency.
 *
 * This is the shape that broke the fleet — `acmeorgb/backend-v2` had
 * exactly this — so it is the shape the CI step has to survive.
 * @returns Absolute path to the scratch project root
 */
function consumerWithoutRuleTestScript(): string {
  const projectDir = path.dirname(copyAstGrepPayload());
  const binDir = path.join(projectDir, LOCAL_BIN_DIR);
  const manifest = `${JSON.stringify(
    { name: "consumer", version: "1.0.0", scripts: { "sg:scan": SCAN_BIN } },
    undefined,
    2
  )}\n`;
  fs.writeFileSync(path.join(projectDir, "package.json"), manifest, "utf-8");
  fs.mkdirSync(binDir, { recursive: true });
  fs.symlinkSync(AST_GREP, path.join(binDir, "ast-grep"));
  return projectDir;
}

/**
 * Run the workflow's rule-test step body verbatim in a project directory.
 *
 * Executes the shell the runner would execute, not a paraphrase of it, so the
 * assertions below measure the shipped step rather than a description of it.
 * @param workflowPath - Workflow file relative to the repository root
 * @param projectDir - Directory to run the step body in
 * @returns Exit status and de-coloured output
 */
function runRuleTestStep(
  workflowPath: string,
  projectDir: string
): { readonly status: number | null; readonly output: string } {
  const step = sgScanSteps(workflowPath).find(candidate =>
    (candidate.name ?? "").includes("Run ast-grep rule tests")
  );
  if (step?.run === undefined) {
    throw new Error(`No rule-test step in ${workflowPath}`);
  }
  const result = boundedSpawnSync({
    label: "the workflow's ast-grep rule-test step",
    command: BASH,
    args: ["-c", step.run],
    cwd: projectDir,
    baseMs: 30_000,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.replace(
      ANSI_PATTERN,
      ""
    ),
  };
}

/**
 * Overwrite a rule test with assertions that are inverted, so the rule tests
 * genuinely fail rather than merely being absent.
 * @param projectDir - Scratch project root
 */
function breakOneRuleTest(projectDir: string): void {
  fs.writeFileSync(
    path.join(projectDir, RULE_TESTS_DIR, "phaser-no-canvas-renderer-test.yml"),
    [
      "id: phaser-no-canvas-renderer",
      "valid:",
      "  - 'const config = { type: Phaser.CANVAS };'",
      "invalid:",
      "  - 'const config = { type: Phaser.WEBGL };'",
      "",
    ].join("\n"),
    "utf-8"
  );
}

/**
 * Copy this repository's ast-grep payload into a scratch project root.
 * @returns Absolute path to the scratch sgconfig.yml
 */
function copyAstGrepPayload(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-sg-ruletests-"));
  fs.cpSync(path.join(REPO_ROOT, "ast-grep"), path.join(tempDir, "ast-grep"), {
    recursive: true,
  });
  fs.copyFileSync(path.join(REPO_ROOT, SGCONFIG), path.join(tempDir, SGCONFIG));
  return path.join(tempDir, SGCONFIG);
}

/**
 * Load a workflow's `sg_scan` job steps.
 * @param workflowPath - Workflow file relative to the repository root
 * @returns Steps declared by the sg_scan job
 */
function sgScanSteps(workflowPath: string): readonly WorkflowStep[] {
  const parsed = loadYaml(readText(workflowPath)) as {
    jobs: Record<string, { steps: readonly WorkflowStep[] } | undefined>;
  };
  const job = parsed.jobs["sg_scan"];
  if (job === undefined) {
    throw new Error(`No sg_scan job in ${workflowPath}`);
  }
  return job.steps;
}

/**
 * Find the single step in a job whose `run` body matches a predicate.
 * @param steps - Steps to search
 * @param matches - Predicate over the step's run body
 * @returns The matching step
 */
function stepRunning(
  steps: readonly WorkflowStep[],
  matches: (run: string) => boolean
): WorkflowStep {
  const found = steps.filter(
    step => typeof step.run === "string" && matches(step.run)
  );
  // Exactly one, so an ungated second copy added later cannot hide behind it.
  expect(found).toHaveLength(1);
  return found[0] as WorkflowStep;
}

/**
 * Assert that a workflow's sg_scan job runs the rule tests behind a real gate.
 * @param workflowPath - Workflow file relative to the repository root
 * @param matches - Predicate identifying the rule-test invocation
 */
function expectGatedRuleTestStep(
  workflowPath: string,
  matches: (run: string) => boolean
): void {
  const steps = sgScanSteps(workflowPath);
  const runStep = stepRunning(steps, matches);
  const gate = steps.find(step => step.id === "check_rule_tests");

  expect(gate?.run).toContain(RULE_TESTS_DIR);
  expect(gate?.run).toContain("has_rule_tests");
  // Without this condition the step goes green in every host project that
  // ships the directory empty, which is a measurement of nothing.
  expect(runStep.if).toContain(RULE_TEST_GATE);
  expect(
    steps.some(
      step =>
        typeof step.run === "string" &&
        step.run.includes("::warning::") &&
        step.run.includes("rule test")
    )
  ).toBe(true);
}

describe("ast-grep rule tests execute", () => {
  it("passes every rule test shipped in this repository", () => {
    const { status, output } = runRuleTests(path.join(REPO_ROOT, SGCONFIG));
    const onDisk = countRuleTestFiles(path.join(REPO_ROOT, RULE_TESTS_DIR));

    // Guards against a vacuous green: `ast-grep test` exits 0 on an empty test
    // directory, so "0 failed" alone would be satisfied by running nothing.
    expect(onDisk).toBeGreaterThan(0);
    expect(output).toContain(`Running ${onDisk} tests`);
    expect(output).toContain(`${onDisk} passed; 0 failed`);
    expect(status).toBe(0);
  });

  it("reports a non-zero exit when a rule test asserts the wrong thing", () => {
    const configPath = copyAstGrepPayload();
    const tempDir = path.dirname(configPath);
    // Inverted on purpose: the valid case is a real violation and the invalid
    // case is clean code, so the runner must report both a Noisy and a Missing
    // result. Asserting both directions is what proves the runner checks the
    // rule rather than merely parsing the file.
    fs.writeFileSync(
      path.join(tempDir, RULE_TESTS_DIR, "phaser-no-canvas-renderer-test.yml"),
      [
        "id: phaser-no-canvas-renderer",
        "valid:",
        "  - 'const config = { type: Phaser.CANVAS };'",
        "invalid:",
        "  - 'const config = { type: Phaser.WEBGL };'",
        "",
      ].join("\n"),
      "utf-8"
    );

    const { status, output } = runRuleTests(configPath);
    fs.rmSync(tempDir, { recursive: true, force: true });

    expect(output).toContain("Noisy");
    expect(output).toContain("Missing");
    expect(output).toContain("FAIL phaser-no-canvas-renderer");
    expect(status).not.toBe(0);
  });

  it("exits zero on an empty test directory, which is why CI counts files", () => {
    const configPath = copyAstGrepPayload();
    const tempDir = path.dirname(configPath);
    fs.rmSync(path.join(tempDir, RULE_TESTS_DIR), {
      recursive: true,
      force: true,
    });
    fs.mkdirSync(path.join(tempDir, RULE_TESTS_DIR));

    const { status, output } = runRuleTests(configPath);
    fs.rmSync(tempDir, { recursive: true, force: true });

    // A host project ships the rule-test directory empty. Left ungated, the CI
    // step would go green here having proved nothing — the exact failure this
    // suite exists to prevent.
    expect(output).toContain("Running 0 tests");
    expect(status).toBe(0);
  });

  it("keeps every sgconfig pointed at the directory CI counts", () => {
    for (const sgconfig of SGCONFIGS) {
      const parsed = loadYaml(readText(sgconfig)) as {
        testConfigs?: readonly { testDir: string }[];
      };
      expect(parsed.testConfigs).toEqual([{ testDir: RULE_TESTS_DIR }]);
    }
  });
});

describe("ast-grep rule tests are wired to a runnable script", () => {
  it("defines the rule-test script in this repository", () => {
    const manifest = JSON.parse(readText("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts[RULE_TEST_SCRIPT]).toBe(RULE_TEST_BIN);
  });

  it("forces the rule-test script onto every stack that forces the scan script", () => {
    for (const manifestPath of MANIFESTS_FORCING_AST_GREP) {
      const scripts = (
        JSON.parse(readText(manifestPath)) as {
          force: { scripts: Record<string, string> };
        }
      ).force.scripts;

      // Paired: a stack that scans but cannot test its rules is the state this
      // ticket removed, so the two scripts must travel together.
      //
      // `sg:scan` is a split pair since #2952 — Lisa forces the reserved
      // `sg:scan:lisa` base and only DEFAULTS `sg:scan` to invoke it, so a host
      // can chain its own scans onto the name CI runs. The governed value is
      // the base; asserting on the bare name would read the delegation.
      expect(scripts["sg:scan:lisa"]).toBe(SCAN_BIN);
      expect(scripts[RULE_TEST_SCRIPT]).toBe(RULE_TEST_BIN);
    }
  });
});

describe("ast-grep rule tests are wired into CI", () => {
  it("runs the rule tests in the TypeScript-family quality workflow", () => {
    expectGatedRuleTestStep(TS_QUALITY_WORKFLOW, run =>
      run.includes(RULE_TEST_INVOCATION)
    );
  });

  it("runs the rule tests in the Rails quality workflow", () => {
    expectGatedRuleTestStep(
      ".github/workflows/quality-rails.yml",
      run => run.trim() === "sg test"
    );
  });

  it("invokes the ast-grep binary, never a host-project package script", () => {
    const steps = sgScanSteps(TS_QUALITY_WORKFLOW);
    const runStep = stepRunning(steps, run =>
      run.includes(RULE_TEST_INVOCATION)
    );

    // The whole failure class in #2530: everything that TRIGGERS this step is
    // shipped by Lisa, while a `package.json` script alias only arrives on the
    // host project's next `lisa apply`. The workflow is consumed at @main, so
    // the two travel at different speeds and cannot be kept in agreement.
    // Depending on the binary instead removes the split entirely.
    expect(runStep.run).not.toContain(RULE_TEST_SCRIPT);
    expect(runStep.run).toContain(RULE_TEST_INVOCATION);
    // The exact pin, not merely the package name: a fallback that floats is
    // a different guarantee from one that runs a known version, and the
    // difference has to be visible here rather than in a consumer's CI.
    expect(runStep.run).toContain(PINNED_CLI);
  });

  it("does not gate the rule tests on anything a host project must supply", () => {
    const steps = sgScanSteps(TS_QUALITY_WORKFLOW);
    const runStep = stepRunning(steps, run =>
      run.includes(RULE_TEST_INVOCATION)
    );

    // The first patch for the fleet outage gated the step on `sg:test`
    // existing, which stopped the red but replaced it with a step that
    // reported success having run nothing — strictly worse than the bug. The
    // gate must be the rule-test FILES and nothing else.
    expect(runStep.if).toContain(RULE_TEST_GATE);
    expect(runStep.if).not.toContain("has_test_script");
    expect(
      steps.some(step => (step.run ?? "").includes("has_test_script"))
    ).toBe(false);
  });
});

/**
 * Executes the shipped step against real project trees. Asserting on the YAML
 * proves what the step SAYS; these prove what it DOES.
 */
describe("the CI rule-test step bites", () => {
  it("passes in a consumer that has rule tests but no sg:test script", () => {
    const projectDir = consumerWithoutRuleTestScript();
    const onDisk = countRuleTestFiles(path.join(projectDir, RULE_TESTS_DIR));
    const { status, output } = runRuleTestStep(TS_QUALITY_WORKFLOW, projectDir);
    fs.rmSync(projectDir, { recursive: true, force: true });

    // Was `error: Script not found "sg:test"` — the fleet outage in #2530.
    expect(output).not.toContain("Script not found");
    // Green because the tests ran and passed, not because nothing ran.
    expect(output).toContain(`Running ${onDisk} tests`);
    expect(output).toContain(`${onDisk} passed; 0 failed`);
    expect(status).toBe(0);
  });

  it("still fails that same consumer when a rule test is genuinely wrong", () => {
    const projectDir = consumerWithoutRuleTestScript();
    breakOneRuleTest(projectDir);
    const { status, output } = runRuleTestStep(TS_QUALITY_WORKFLOW, projectDir);
    fs.rmSync(projectDir, { recursive: true, force: true });

    // The control that matters: removing the script dependency must not have
    // made the step unable to report failure.
    expect(output).toContain("FAIL phaser-no-canvas-renderer");
    expect(status).not.toBe(0);
  });
});
