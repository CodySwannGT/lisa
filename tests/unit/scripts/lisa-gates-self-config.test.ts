/**
 * Unit tests for Lisa's own gate wiring: the `check:artifacts` consolidation
 * and the `gates` / `policy` blocks in `.lisa.config.json`.
 *
 * Three properties are load-bearing, none obvious from reading the JSON.
 *
 * `artifact-freshness` must prove every derived artifact. The registry admits
 * one task per gate, so the four `--check` scripts had to be composed — and a
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
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contextsFor,
  HARDCODED_INVOCATIONS,
  MOMENTS,
  readGates,
  resolveMoment,
  validateGates,
  validatePolicy,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

/** One gate resolved at one moment, as `resolveMoment` reports it. */
interface GateEntry {
  readonly id: string;
  readonly level: string;
  readonly task: string | null;
  /** `run`, `await`, `intercept`, or `off`. */
  readonly mode: string;
  /** The context an awaited gate waits on, else null. */
  readonly awaits: string | null;
  /** The GitHub App id allowed to post an awaited context, else null. */
  readonly postedBy: number | null;
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

/** The gate whose single task is composed from three generator checks. */
const ARTIFACT_GATE = "artifact-freshness";
const ARTIFACTS_TASK = "check:artifacts";

/** The generator checks `check:artifacts` composes, by task name. */
const MANIFEST_TASK = "bun run check:upstream-evidence-manifest";
const LEDGER_TASK = "bun run check:lisa-owned-hash-ledger";
const CERTIFICATE_TASK = "bun run check:nightly-guard-certificate";
const TWO_CHANNEL_TASK = "bun run check:two-channel-couplings";

/** Stub names, and the order all must appear in however any one exits. */
const MANIFEST = "manifest";
const LEDGER = "ledger";
const CERTIFICATE = "certificate";
const TWO_CHANNEL = "two-channel";
const ALL_RAN = [MANIFEST, LEDGER, CERTIFICATE, TWO_CHANNEL];

/** Moment whose required gates become branch-protection contexts. */
const PULL_REQUEST = "pull-request";

/** The public command the built-in Node-suite facade must execute. */
const TEST_NODE_SUITES_COMMAND =
  "lisa-test-run --profile <stack-or-node> --adapter direct -- node <lisa>/scripts/lisa-test-node.mjs";

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
  // Promoted in #2932, in the same change that gave the property a gate and
  // moved its third enforcement point into the gated job.
  "🔍 Quality Checks / 📚 Learnings Budget",
  "🔍 Quality Checks / 🔍 Type Check",
  "🔍 Quality Checks / 🔗 Work-Item Traceability",
  "🔍 Quality Checks / 🗑️ Dead Code Detection",
  "🔍 Quality Checks / 🧪 Run Integration Tests",
  "🔍 Quality Checks / 🧪 Run Unit Tests",
  "🔍 Quality Checks / 🧹 Lint",
  // Bootstrapped and promoted together on #1547: declaring the first root BDD
  // contract without making this context required would leave it advisory.
  "🔍 Quality Checks / 🧾 BDD Behavior Contract",
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
 * The shipped `check:artifacts` command with all generators stubbed out.
 *
 * Only the two invocations are substituted, so the control flow under test is
 * the one that ships rather than a restatement of it.
 * @param log - File each stub appends its name to when it runs
 * @param manifestExit - Exit code the manifest check should report
 * @param ledgerExit - Exit code the ledger check should report
 * @param certificateExit - Exit code the certificate check should report
 * @param twoChannelExit - Exit code the two-channel check should report
 * @returns A shell command equivalent to the real script
 */
function composeWithStubs(
  log: string,
  manifestExit: number,
  ledgerExit: number,
  certificateExit: number,
  twoChannelExit: number
): string {
  const stub = (name: string, code: number): string =>
    `sh -c 'printf "%s\\n" ${name} >> ${log}; exit ${code}'`;
  const composed = script(ARTIFACTS_TASK)
    .replace(MANIFEST_TASK, stub(MANIFEST, manifestExit))
    .replace(LEDGER_TASK, stub(LEDGER, ledgerExit))
    .replace(CERTIFICATE_TASK, stub(CERTIFICATE, certificateExit))
    .replace(TWO_CHANNEL_TASK, stub(TWO_CHANNEL, twoChannelExit));
  if (
    composed.includes(MANIFEST_TASK) ||
    composed.includes(LEDGER_TASK) ||
    composed.includes(CERTIFICATE_TASK) ||
    composed.includes(TWO_CHANNEL_TASK)
  ) {
    throw new Error(
      `${ARTIFACTS_TASK} no longer invokes all checks as \`bun run <task>\`; ` +
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
    boundedExecFileSync({
      label: "check:artifacts composition under /bin/sh",
      command: "/bin/sh",
      args: ["-c", command],
      stdio: "ignore",
    });
  } catch (error) {
    code = (error as { exitCode?: number }).exitCode ?? -1;
  }
  return code;
}

/**
 * Run `check:artifacts` with all generators replaced by exit-code stubs.
 * @param manifestExit - Exit code the manifest check should report
 * @param ledgerExit - Exit code the ledger check should report
 * @param certificateExit - Exit code the certificate check should report
 * @param twoChannelExit - Exit code the two-channel check should report
 * @returns The composition's exit code and the order the stubs ran in
 */
function runComposition(
  manifestExit: number,
  ledgerExit: number,
  certificateExit: number,
  twoChannelExit: number
): { code: number; ran: string[] } {
  const log = path.join(scratchDirectory(), "ran.log");
  const code = shellExitCode(
    composeWithStubs(
      log,
      manifestExit,
      ledgerExit,
      certificateExit,
      twoChannelExit
    )
  );
  const ran = readFileSync(log, "utf8").split("\n").filter(Boolean);
  return { code, ran };
}

describe("check:artifacts consolidates every derived-artifact check", () => {
  it("is the single task the artifact-freshness gate names", () => {
    const config = parsedConfig();
    expect(Object.keys(config.gates)).toContain(ARTIFACT_GATE);
    const gate = gatesAt(config, "commit").find(
      entry => entry.id === ARTIFACT_GATE
    );
    expect(gate?.task).toBe(ARTIFACTS_TASK);
    expect(gate?.level).toBe("required");
  });

  it("delegates to every existing check script rather than restating them", () => {
    expect(script(ARTIFACTS_TASK)).toContain(MANIFEST_TASK);
    expect(script(ARTIFACTS_TASK)).toContain(LEDGER_TASK);
    expect(script(ARTIFACTS_TASK)).toContain(CERTIFICATE_TASK);
    expect(script(ARTIFACTS_TASK)).toContain(TWO_CHANNEL_TASK);
    expect(script("check:upstream-evidence-manifest")).toBe(
      "node scripts/generate-upstream-evidence-manifest.mjs --check"
    );
    expect(script("check:lisa-owned-hash-ledger")).toBe(
      "node scripts/generate-lisa-owned-hash-ledger.mjs --check"
    );
    expect(script("check:nightly-guard-certificate")).toBe(
      "node scripts/generate-nightly-e2e-guard-certificate.mjs --check"
    );
    expect(script("check:two-channel-couplings")).toBe(
      "bun scripts/generate-two-channel-couplings.ts --check"
    );
  });

  it("passes only when all checks pass", () => {
    const result = runComposition(0, 0, 0, 0);
    expect(result.code).toBe(0);
    expect(result.ran).toEqual(ALL_RAN);
  });

  it("fails when only the first check fails, and still runs the rest", () => {
    const result = runComposition(1, 0, 0, 0);
    expect(result.code).toBe(1);
    expect(result.ran).toEqual(ALL_RAN);
  });

  it("fails when only the second check fails", () => {
    const result = runComposition(0, 1, 0, 0);
    expect(result.code).toBe(1);
    expect(result.ran).toEqual(ALL_RAN);
  });

  it("fails when only the third check fails", () => {
    const result = runComposition(0, 0, 1, 0);
    expect(result.code).toBe(1);
    expect(result.ran).toEqual(ALL_RAN);
  });

  it("fails when only the fourth check fails", () => {
    const result = runComposition(0, 0, 0, 1);
    expect(result.code).toBe(1);
    expect(result.ran).toEqual(ALL_RAN);
  });

  it("fails when every check fails", () => {
    const result = runComposition(1, 1, 1, 1);
    expect(result.code).toBe(1);
    expect(result.ran).toEqual(ALL_RAN);
  });
});

// ---------------------------------------------------------------------------
// #3888: the composition's LAST line must state the verdict.
//
// Five `--check` scripts run in sequence, each printing its own diagnosis. The
// wrapper's exit code was always right, but its final line was the innocuous
// tail of whichever check happened to run last — so a reader (or an agent
// scrolling to the end of a long gate log) saw a benign summary sitting under
// real failures that had scrolled away. A verdict that can only be recovered
// by reading upward is a verdict the reader does not have.
//
// So the composition ends by naming what happened: on success the COUNT it
// proved, on failure the names of the checks that failed.
// ---------------------------------------------------------------------------
describe("check:artifacts states its verdict last", () => {
  /**
   * Run the stubbed composition and return its exit code and final line.
   * @param exits - Exit codes for the manifest, ledger, certificate and
   *   two-channel checks, in that order
   * @returns The exit code and the last non-empty line of stdout
   */
  function lastLine(exits: readonly [number, number, number, number]): {
    code: number;
    line: string;
  } {
    const log = path.join(scratchDirectory(), "ran.log");
    const command = composeWithStubs(log, ...exits);
    let stdout = "";
    let code = 0;
    try {
      stdout = boundedExecFileSync({
        label: "check:artifacts verdict under /bin/sh",
        command: "/bin/sh",
        args: ["-c", command],
      });
    } catch (error) {
      const failure = error as { exitCode?: number; stdout?: string };
      code = failure.exitCode ?? -1;
      stdout = failure.stdout ?? "";
    }
    const lines = stdout.split("\n").filter(entry => entry.trim() !== "");
    return { code, line: lines[lines.length - 1] ?? "" };
  }

  it("names the count it proved when every check passes", () => {
    const { code, line } = lastLine([0, 0, 0, 0]);

    expect(code).toBe(0);
    // Six since CodySwannGT/lisa#3932 added `check:merge-coverage`. Hardcoded
    // per the Test Isolation house rule: deriving it from the script would
    // make the assertion agree with whatever the script happens to say.
    expect(line).toContain("all 6 generated-artifact checks passed");
  });

  it("names the failing check last, where a reader is already looking", () => {
    const { code, line } = lastLine([0, 1, 0, 0]);

    expect(code).toBe(1);
    expect(line).toContain("FAILED");
    expect(line).toContain("lisa-owned-hash-ledger");
    expect(line).not.toContain("upstream-evidence-manifest");
  });

  it("names every failing check, not just the first", () => {
    const { code, line } = lastLine([1, 0, 1, 0]);

    expect(code).toBe(1);
    expect(line).toContain("upstream-evidence-manifest");
    expect(line).toContain("nightly-guard-certificate");
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

describe("the Node-suite facade uses the supervised public command", () => {
  it("runs the built-in fallback through the direct adapter", async () => {
    const imported = HARDCODED_INVOCATIONS.find(
      entry => entry.job === "test_node_suites"
    );
    vi.resetModules();
    const activated =
      await import("../../../all/copy-overwrite/scripts/lisa-gates.mjs");
    const invocation = activated.HARDCODED_INVOCATIONS.find(
      entry => entry.job === "test_node_suites"
    );

    expect(imported?.command).toBe(TEST_NODE_SUITES_COMMAND);
    expect(invocation?.command).toBe(TEST_NODE_SUITES_COMMAND);
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

  /** The two gates one push pass proves together, in sorted order. */
  const COVERAGE_PROVER_GATES = ["coverage-adequacy", "test-correctness"];

  /**
   * Resolve the single pass that proves both correctness and coverage at push.
   *
   * Derived from the configuration rather than written here, so a deliberate
   * rename of the push task does not read as a regression. What must not
   * change is the shape: exactly these two gates, sharing exactly ONE task.
   * @returns The push task both provers resolve to
   */
  function splitCoverageTask(): string {
    const covering = gatesAt(parsedConfig(), PUSH).filter(entry =>
      COVERAGE_PROVER_GATES.includes(entry.id)
    );
    expect(
      covering
        .map(entry => entry.id)
        .toSorted((left, right) => left.localeCompare(right))
    ).toEqual(COVERAGE_PROVER_GATES);
    const tasks = [...new Set(covering.map(entry => entry.task))];
    // One task, not two: the same run proves both properties, and the pre-push
    // step stands down only when both are declared against it.
    expect(tasks).toHaveLength(1);
    const [task] = tasks;
    if (typeof task !== "string")
      throw new Error("Push coverage prover resolves to no task");
    return task;
  }

  it("keeps the coverage prover out of the integration directory", () => {
    // The exclusion is the property; the LISA_COVERAGE_SCOPE=unit prefix the
    // script also carries is what gives the narrower run its own threshold
    // block, and is asserted where that mechanism lives.
    expect(script(splitCoverageTask())).toContain(
      "vitest run --coverage --exclude='**/integration/**'"
    );
  });

  /**
   * The temp-growth BENCHMARK must not run inside the pre-push pass.
   *
   * It builds three real 100,000-entry corpora in the shared platform temp
   * root — 300,000 entries — and asserts wall-clock command latency. On a
   * machine running many concurrent agents that is both the slowest file in
   * the suite and a load spike every other lane pays for, and it failed the
   * push gate on branches whose diffs could not reach it.
   *
   * It is excluded by FILE and still runs in the full suite CI drives, exactly
   * as the mutation performance suites are excluded from `test:integration:push`.
   * Without this assertion the split would be free to rot back silently.
   */
  it("keeps the 100k temp-growth benchmark out of the push pass", () => {
    const pushTask = splitCoverageTask();

    expect(script(pushTask)).toContain(
      "--exclude='**/measure-tmpdir-growth-performance.test.ts'"
    );
    // The benchmark still runs somewhere: the PR-moment prover must NOT
    // exclude it, or the split would have deleted the coverage rather than
    // relocated it.
    const prTask = gatesAt(parsedConfig(), "pull-request").find(
      entry => entry.id === "test-correctness"
    )?.task;
    expect(prTask).toBeDefined();
    expect(prTask).not.toBe(pushTask);
    expect(script(prTask as string)).not.toContain(
      "measure-tmpdir-growth-performance"
    );
  });

  /**
   * Suites that NAME Stryker without driving it.
   *
   * Membership in the expensive set is discovered by searching the file for
   * the tool's name, which is deliberately BROAD: a suite that starts driving
   * Stryker is caught the moment it mentions it, without anyone remembering
   * to update a list. The cost of that breadth is a false positive, and this
   * is where one is paid off — explicitly, in a reviewable line, rather than
   * by narrowing discovery.
   *
   * Narrowing was tried and was wrong in the dangerous direction. Keying on a
   * spawn call in the file classified `mutation-gate-bite.test.ts` as
   * mention-only, because it reaches Stryker through a helper and contains no
   * spawn call of its own — so the heuristic would have stopped requiring the
   * exclusion for the very suite the exclusion exists for. Broad discovery
   * plus a named exemption fails safe; a clever predicate failed open.
   *
   * `gate-labels-name-properties.test.ts` lists `stryker` among the vendor
   * names a gate label may not contain, and
   * `job-names-name-properties.test.ts` is its mirror over CI job names and
   * carries the same list for the same reason — one ruling, one denylist.
   * Both spawn nothing and cost milliseconds.
   *
   * The entry is a CLAIM, not a permission. `cannotStartAProcess` below has to
   * agree with it, so an exempt suite that later starts driving Stryker fails
   * here rather than keeping an exemption it has outgrown — which is the
   * failure mode an allowlist added to harden a guard usually becomes.
   */
  const MENTIONS_WITHOUT_DRIVING = [
    "gate-labels-name-properties.test.ts",
    "job-names-name-properties.test.ts",
  ];

  /**
   * Whether a suite can reach a child process at all.
   *
   * Checked one level through its own relative imports, because "starts
   * Stryker through a helper" is exactly how the narrowed predicate was fooled
   * — the driving suite's own text is clean and the helper does the work. A
   * suite that acquires that ability has to import it from somewhere, and this
   * is what notices.
   *
   * The bound is honest and stated: ONE level. A helper that imports a second
   * helper that spawns would pass. That is a smaller hole than "we wrote a
   * name on a list", and closing it entirely means resolving the module graph,
   * which is a heavier tool than this assertion earns.
   * @param entry Basename of a suite under `tests/integration`.
   * @returns True when neither the suite nor its direct relative imports can
   *   start a process.
   */
  const cannotStartAProcess = (entry: string): boolean => {
    const suite = path.join("tests", "integration", entry);
    const sources = [suite];
    const text = readFileSync(suite, "utf8");
    for (const match of text.matchAll(/from\s+"(\.[^"]+)"/gu)) {
      const specifier = (match[1] ?? "").replace(/\.js$/u, ".ts");
      const resolved = path.join(path.dirname(suite), specifier);
      if (existsSync(resolved)) sources.push(resolved);
    }
    return sources.every(
      file => !/child_process/u.test(readFileSync(file, "utf8"))
    );
  };

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
    const mentions = readdirSync(integration).filter(
      entry =>
        entry.endsWith(".test.ts") &&
        /stryker/iu.test(readFileSync(path.join(integration, entry), "utf8"))
    );
    const spawning = mentions.filter(
      entry => !MENTIONS_WITHOUT_DRIVING.includes(entry)
    );
    const mentionOnly = mentions.filter(entry =>
      MENTIONS_WITHOUT_DRIVING.includes(entry)
    );
    // A stale exemption is worse than none: it would silently stop requiring
    // the exclusion for a suite that had since started driving Stryker. So an
    // entry that no longer even mentions the tool fails here rather than
    // sitting inert.
    expect(
      MENTIONS_WITHOUT_DRIVING.filter(entry => !mentions.includes(entry))
    ).toEqual([]);
    // And the exemption has to remain TRUE, not merely present. Without this
    // the list is a bypass: an exempt suite that grew a Stryker run would keep
    // its exemption, and the exclusion the whole test exists to require would
    // quietly stop applying to it.
    expect(
      MENTIONS_WITHOUT_DRIVING.filter(entry => !cannotStartAProcess(entry)),
      "an exempt suite acquired the ability to start a process — either it now " +
        "drives Stryker, in which case remove the exemption and add the " +
        "--exclude, or it spawns something unrelated, in which case say so here"
    ).toEqual([]);

    // The absent case: a discovery bug would make the loop below compare
    // nothing to nothing and pass having measured no suite at all.
    expect(spawning.length).toBeGreaterThan(0);

    const command = script("test:integration:push");
    expect(command).toContain(
      "lisa-test-run -- --adapter vitest -- vitest run tests/integration"
    );
    for (const suite of spawning) {
      expect(command, suite).toContain(`--exclude='**/${suite}'`);
    }
    // The other direction, and the reason the split is safe to make: a suite
    // that only names the tool must still RUN at push. Without this, narrowing
    // discovery could be undone later by excluding a cheap suite anyway and
    // nothing would object.
    for (const suite of mentionOnly) {
      expect(command, suite).not.toContain(`--exclude='**/${suite}'`);
    }
  });

  it("does not drop the bite test — it moves to the moment that owns its cost", () => {
    // The mutation gate it is the bite control for is a pull-request gate, and
    // the pull-request integration pass still collects the whole directory.
    const onPr = gatesAt(parsedConfig(), PULL_REQUEST).find(
      entry => entry.id === "test-integration"
    );
    expect(onPr?.task).toBe("test:integration");
    expect(script("test:integration")).toBe(
      "$npm_execpath run lisa-test-run -- --adapter vitest -- vitest run tests/integration"
    );
  });
});
