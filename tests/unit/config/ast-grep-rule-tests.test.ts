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
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { load as loadYaml } from "js-yaml";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const AST_GREP = path.join(REPO_ROOT, "node_modules/.bin/ast-grep");
const RULE_TESTS_DIR = "ast-grep/rule-tests";
const RULE_TEST_SCRIPT = "sg:test";
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
  const result = spawnSync(AST_GREP, ["test", "--config", configPath], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
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
    expect(manifest.scripts[RULE_TEST_SCRIPT]).toBe("ast-grep test");
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
      expect(scripts["sg:scan"]).toBe("ast-grep scan");
      expect(scripts[RULE_TEST_SCRIPT]).toBe("ast-grep test");
    }
  });
});

describe("ast-grep rule tests are wired into CI", () => {
  it("runs the rule-test script in the TypeScript-family quality workflow", () => {
    expectGatedRuleTestStep(".github/workflows/quality.yml", run =>
      run.includes("run sg:test")
    );
  });

  it("runs the rule tests in the Rails quality workflow", () => {
    expectGatedRuleTestStep(
      ".github/workflows/quality-rails.yml",
      run => run.trim() === "sg test"
    );
  });
});
