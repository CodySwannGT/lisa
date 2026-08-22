/**
 * Unit tests for Lisa's own gate wiring: the `check:artifacts` consolidation
 * and the `gates` / `policy` blocks in `.lisa.config.json`.
 *
 * Three properties are load-bearing, none obvious from reading the JSON.
 *
 * `artifact-freshness` must prove BOTH derived artifacts. The registry admits
 * one task per gate, so the two `--check` scripts had to be composed — and a
 * composition that stops at the first failure, or lets the second command's
 * exit code overwrite the first's, is a gate reporting green on a stale
 * artifact. All four pass/fail combinations are exercised with stubs.
 *
 * Every task the gates block names must exist in the runner. A gate pointing at
 * a renamed script fails as "missing script", which reads like an environment
 * problem rather than a lost guarantee.
 *
 * Every `required` gate must derive a context the ruleset actually names. A
 * context GitHub cannot find never runs; one the ruleset drops stops gating.
 *
 * `lisa-gates.mjs` describes itself in JSDoc, so its parsed config and resolved
 * entries arrive here as bare `object`. The local types below are this file's
 * own narrow reading of that shape.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED rather than
 * recomputed from the code under test.
 * @module tests/unit/scripts/lisa-gates-self-config
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  contextsFor,
  MOMENTS,
  readGates,
  resolveMoment,
  validateGates,
  validatePolicy,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

/** One gate resolved at one moment, as `resolveMoment` reports it. */
interface GateEntry {
  readonly id: string;
  readonly level: string;
  readonly task: string | null;
}

/** The `gates` block with the runner split out, keyed by gate id. */
type GatesBlock = Readonly<Record<string, unknown>>;

/** What `readGates` returns for `.lisa.config.json`. */
interface ParsedConfig {
  readonly runner: string;
  readonly gates: GatesBlock;
  readonly policy: object;
}

const scripts = (
  JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string | undefined>;
  }
).scripts;

/** The gate whose single task is composed from two generator checks. */
const ARTIFACT_GATE = "artifact-freshness";
const ARTIFACTS_TASK = "check:artifacts";

/** The two generator checks `check:artifacts` composes, by task name. */
const MANIFEST_TASK = "bun run check:upstream-evidence-manifest";
const LEDGER_TASK = "bun run check:lisa-owned-hash-ledger";

/** Stub names, and the order both must appear in however either one exits. */
const MANIFEST = "manifest";
const LEDGER = "ledger";
const BOTH_RAN = [MANIFEST, LEDGER];

/** Moment whose required gates become branch-protection contexts. */
const PULL_REQUEST = "pull-request";

/**
 * Contexts the `required` pull-request gates imply.
 *
 * Seven were verified 2026-08-15 as a strict subset of the live `quality
 * checks` ruleset. `🐢 Slow Lint Rules` and `🗑️ Dead Code Detection` joined on
 * #2861: #2862 added them to the ruleset TEMPLATE, and they are declared here
 * so `contextsFor` derives them too. Until the next
 * `scripts/lisa-github-rulesets.sh` run provisions the template, those two are
 * declared-but-not-yet-live — which `lisa-reconcile-policy` reports as MISSING
 * and `on_drift: repair` converges by ADDING them. That is the safe direction;
 * the state this replaced had them live-but-not-declared, where `repair
 * --prune` would have deleted them.
 *
 * The two vendor contexts joined on #2917. They were pinned into every
 * repository by `all/github-rulesets/base.json`, which is now deleted; they are
 * declared here as `await` gates instead, and both were verified live on the
 * `base` ruleset the same day. `contextsFor` emits an awaited gate's context
 * verbatim rather than deriving `🔍 Quality Checks / <label>`, which is why
 * these two are the only entries without that prefix.
 */
const AWAITED_VENDOR_CONTEXTS = ["CodeRabbit", "GitGuardian Security Checks"];

const REQUIRED_PR_CONTEXTS = [
  "🔍 Quality Checks / 🏗️ Build",
  "🔍 Quality Checks / 🐢 Slow Lint Rules",
  "🔍 Quality Checks / 📐 Check Formatting",
  "🔍 Quality Checks / 🔍 Type Check",
  "🔍 Quality Checks / 🔗 Work-Item Traceability",
  "🔍 Quality Checks / 🗑️ Dead Code Detection",
  "🔍 Quality Checks / 🧪 Run Integration Tests",
  "🔍 Quality Checks / 🧪 Run Unit Tests",
  "🔍 Quality Checks / 🧹 Lint",
  // Last, not first: contextsFor sorts with localeCompare, which orders every
  // emoji-prefixed derived context ahead of a plain vendor name.
  ...AWAITED_VENDOR_CONTEXTS,
];

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * A package.json script, failing loudly rather than silently as `undefined`.
 * @param name - Script name
 * @returns The command that script runs
 */
function script(name: string): string {
  const command = scripts[name];
  if (command === undefined) {
    throw new Error(`package.json declares no "${name}" script`);
  }
  return command;
}

/**
 * `.lisa.config.json` as this file reads it.
 * @returns The runner, the gates block, and the policy block
 */
function parsedConfig(): ParsedConfig {
  return readGates() as ParsedConfig;
}

/**
 * The gates that run at one moment, typed for this file.
 * @param config - Parsed config
 * @param moment - Moment to resolve
 * @returns Resolved entries, sorted by gate id
 */
function gatesAt(config: ParsedConfig, moment: string): GateEntry[] {
  const { gates, runner } = config;
  return resolveMoment({ gates, moment, runner }) as GateEntry[];
}

/**
 * A scratch directory this file's `afterEach` will remove.
 * @returns Absolute path to the new directory
 */
function scratchDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-check-artifacts-"));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * The shipped `check:artifacts` command with both generators stubbed out.
 *
 * Only the two invocations are substituted, so the control flow under test is
 * the one that ships rather than a restatement of it.
 * @param log - File each stub appends its name to when it runs
 * @param manifestExit - Exit code the manifest check should report
 * @param ledgerExit - Exit code the ledger check should report
 * @returns A shell command equivalent to the real script
 */
function composeWithStubs(
  log: string,
  manifestExit: number,
  ledgerExit: number
): string {
  const stub = (name: string, code: number): string =>
    `sh -c 'printf "%s\\n" ${name} >> ${log}; exit ${code}'`;
  const composed = script(ARTIFACTS_TASK)
    .replace(MANIFEST_TASK, stub(MANIFEST, manifestExit))
    .replace(LEDGER_TASK, stub(LEDGER, ledgerExit));
  if (composed.includes(MANIFEST_TASK) || composed.includes(LEDGER_TASK)) {
    throw new Error(
      `${ARTIFACTS_TASK} no longer invokes both checks as \`bun run <task>\`; ` +
        "the stub substitution below tests nothing until it is updated."
    );
  }
  return composed;
}

/**
 * The exit code of a shell command.
 * @param command - Command to run under `/bin/sh -c`
 * @returns Its exit status, 0 when it succeeded
 */
function shellExitCode(command: string): number {
  let code = 0;
  try {
    execFileSync("/bin/sh", ["-c", command], { stdio: "ignore" });
  } catch (error) {
    code = (error as { status?: number }).status ?? -1;
  }
  return code;
}

/**
 * Run `check:artifacts` with both generators replaced by exit-code stubs.
 * @param manifestExit - Exit code the manifest check should report
 * @param ledgerExit - Exit code the ledger check should report
 * @returns The composition's exit code and the order the stubs ran in
 */
function runComposition(
  manifestExit: number,
  ledgerExit: number
): { code: number; ran: string[] } {
  const log = path.join(scratchDirectory(), "ran.log");
  const code = shellExitCode(composeWithStubs(log, manifestExit, ledgerExit));
  const ran = readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { code, ran };
}

describe("check:artifacts consolidates both derived-artifact checks", () => {
  it("is the single task the artifact-freshness gate names", () => {
    const config = parsedConfig();
    expect(Object.keys(config.gates)).toContain(ARTIFACT_GATE);
    const gate = gatesAt(config, "commit").find(
      entry => entry.id === ARTIFACT_GATE
    );
    expect(gate?.task).toBe(ARTIFACTS_TASK);
    expect(gate?.level).toBe("required");
  });

  it("delegates to both existing check scripts rather than restating them", () => {
    expect(script(ARTIFACTS_TASK)).toContain(MANIFEST_TASK);
    expect(script(ARTIFACTS_TASK)).toContain(LEDGER_TASK);
    expect(script("check:upstream-evidence-manifest")).toBe(
      "node scripts/generate-upstream-evidence-manifest.mjs --check"
    );
    expect(script("check:lisa-owned-hash-ledger")).toBe(
      "node scripts/generate-lisa-owned-hash-ledger.mjs --check"
    );
  });

  it("passes only when both checks pass", () => {
    const result = runComposition(0, 0);
    expect(result.code).toBe(0);
    expect(result.ran).toEqual(BOTH_RAN);
  });

  it("fails when only the first check fails, and still runs the second", () => {
    const result = runComposition(1, 0);
    expect(result.code).toBe(1);
    expect(result.ran).toEqual(BOTH_RAN);
  });

  it("fails when only the second check fails", () => {
    const result = runComposition(0, 1);
    expect(result.code).toBe(1);
    expect(result.ran).toEqual(BOTH_RAN);
  });

  it("fails when both checks fail", () => {
    const result = runComposition(1, 1);
    expect(result.code).toBe(1);
    expect(result.ran).toEqual(BOTH_RAN);
  });
});

describe("Lisa's own gates and policy blocks", () => {
  it("validate clean against the registry Lisa ships", () => {
    const config = parsedConfig();
    expect(validateGates(config.gates)).toEqual([]);
    expect(validatePolicy(config.policy)).toEqual([]);
  });

  it("names only tasks that exist in the runner", () => {
    const config = parsedConfig();
    const missing: string[] = [];
    for (const moment of MOMENTS) {
      for (const gate of gatesAt(config, moment)) {
        if (gate.task !== null && scripts[gate.task] === undefined) {
          missing.push(`${gate.id} -> ${gate.task}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("declares bun as the runner, matching this repository's hooks", () => {
    expect(parsedConfig().runner).toBe("bun run");
  });
});

describe("gates backing a required branch-protection context", () => {
  it("derives exactly the contexts the ruleset template requires", () => {
    expect(contextsFor(parsedConfig().gates) as string[]).toEqual(
      REQUIRED_PR_CONTEXTS
    );
  });

  // The vendor contexts must be AWAITED, never derived. A derived context is
  // `🔍 Quality Checks / <label>` and is pinned to GitHub Actions, so declaring
  // either of these as a gate Lisa runs would require a status the only app
  // able to post it can never satisfy.
  it("declares each vendor context as an awaited signal with its app id", () => {
    const gates = gatesAt(parsedConfig(), PULL_REQUEST).filter(
      entry => entry.mode === "await"
    );

    const byName = (left: string, right: string): number =>
      left.localeCompare(right);
    expect(gates.map(entry => entry.awaits).sort(byName)).toEqual(
      [...AWAITED_VENDOR_CONTEXTS].sort(byName)
    );
    expect(gates.every(entry => entry.level === "required")).toBe(true);
    expect(gates.every(entry => Number.isInteger(entry.postedBy))).toBe(true);
  });

  it("proves traceability with the subcommand the CI job runs", () => {
    const gate = gatesAt(parsedConfig(), PULL_REQUEST).find(
      entry => entry.id === "traceability"
    );
    expect(gate?.level).toBe("required");
    expect(gate?.task).toBe("check:work-item");
    expect(script("check:work-item")).toBe(
      "node scripts/lisa-work-item.mjs validate-pr"
    );
  });

  it("points the threshold ratchet at its canonical implementation", () => {
    expect(script("check:thresholds")).toContain(
      "plugins/src/base/hooks/threshold-ratchet.mjs"
    );
  });
});

describe("the push moment does not run a nested mutation run inside a suite", () => {
  /**
   * `tests/integration/mutation-gate-bite.test.ts` spawns the real Stryker
   * gate — twice — and Stryker in turn spawns one test-runner process per
   * core. Inside a parallel run of the whole 800-file suite that child starves
   * waiting for CPU its own siblings hold, which is the mechanism behind six
   * sightings of "coverage-adequacy failed, and passed on retry" against
   * diffs that could not move a coverage number.
   *
   * CI does not hit it because CI runs the unit pass and the integration pass
   * as separate jobs. Splitting the local passes the same way is the fix, so
   * both push provers below must leave that file out of the parallel run.
   */
  const PUSH = "push";

  /** The one pass that proves both correctness and coverage at push. */
  const SPLIT_COVERAGE_TASK = "test:cov:unit";

  it("keeps the coverage prover out of the integration directory", () => {
    const covering = gatesAt(parsedConfig(), PUSH).filter(entry =>
      ["coverage-adequacy", "test-correctness"].includes(entry.id)
    );
    expect(covering.map(entry => entry.task)).toEqual([
      SPLIT_COVERAGE_TASK,
      SPLIT_COVERAGE_TASK,
    ]);
    expect(script(SPLIT_COVERAGE_TASK)).toBe(
      "vitest run --coverage --exclude='**/integration/**'"
    );
  });

  it("keeps every Stryker-spawning bite test out of the push integration pass", () => {
    // Derived, not a literal command string. A second bite test was added and
    // the hardcoded assertion here was the only thing that noticed — which is
    // the wrong way round: the exclusion is what matters, and it should keep
    // holding as suites are added rather than needing this line edited each
    // time. Membership is "the suite drives Stryker", read from the suites.
    const gate = gatesAt(parsedConfig(), PUSH).find(
      entry => entry.id === "test-integration"
    );
    expect(gate?.task).toBe("test:integration:push");

    const integration = path.join("tests", "integration");
    const spawning = readdirSync(integration).filter(
      entry =>
        entry.endsWith(".test.ts") &&
        /stryker/iu.test(readFileSync(path.join(integration, entry), "utf8"))
    );
    // The absent case: a discovery bug would make the loop below compare
    // nothing to nothing and pass having measured no suite at all.
    expect(spawning.length).toBeGreaterThan(0);

    const command = script("test:integration:push");
    expect(command.startsWith("vitest run tests/integration")).toBe(true);
    for (const suite of spawning) {
      expect(command, suite).toContain(`--exclude='**/${suite}'`);
    }
  });

  it("does not drop the bite test — it moves to the moment that owns its cost", () => {
    // The mutation gate it is the bite control for is a pull-request gate, and
    // the pull-request integration pass still collects the whole directory.
    const onPr = gatesAt(parsedConfig(), PULL_REQUEST).find(
      entry => entry.id === "test-integration"
    );
    expect(onPr?.task).toBe("test:integration");
    expect(script("test:integration")).toBe("vitest run tests/integration");
  });
});
