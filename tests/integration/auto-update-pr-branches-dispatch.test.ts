/**
 * Contract and behaviour coverage for the auto-update PR branches dispatch
 * handler.
 *
 * The workflow this covers previously updated 3 of 4 pull requests and reported
 * success (CodySwannGT/lisa#3512). It could do that because the loop was an
 * English prompt handed to an LLM under `--max-turns 3`, wrapped in
 * `continue-on-error: true`, whose only per-PR diagnostic conflated *update
 * failed* with *already up to date*.
 *
 * So the assertions come in two halves, and the second is the one that matters:
 * 1. **Contract** — the common path is a script, the gate is not opted out of
 *    failing, and the agent survives only for the conflict case.
 * 2. **Behaviour** — the gate's own shell, extracted from the YAML and executed
 *    against a stubbed `gh`, is shown to FAIL when a PR is left behind. A gate
 *    never observed failing is indistinguishable from the one this replaced,
 *    which is exactly how the original defect stayed invisible.
 * @module tests/integration/auto-update-pr-branches-dispatch
 */

import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "reusable-auto-update-pr-branches-dispatch.yml"
);

/** Absolute so the harness never resolves its interpreter through PATH. */
const BASH = "/bin/bash";

/** The single job that performs the updates, for both dispatch actions. */
const UPDATE_JOB = "update-pr-branches";
const VERIFY_STEP = "Verify branch freshness";
const UPDATE_STEP = "Update PR branches";
const DISCOVER_STEP = "Discover pull requests in scope";

/** Fixture branch names, shared so the base appears once. */
const BASE = "main";
const HEAD_A = "acme:feat-a";
const HEAD_B = "acme:feat-b";
const HEAD_C = "acme:feat-c";
const CURRENT = "0";

/** The subset of a workflow step this suite reads. */
interface Step {
  readonly id?: string;
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly if?: string;
  readonly "continue-on-error"?: boolean;
}

/** The subset of a workflow job this suite reads. */
interface Job {
  readonly steps?: readonly Step[];
}

/** The subset of a parsed workflow this suite reads. */
interface ParsedWorkflow {
  readonly jobs: Record<string, Job>;
}

/** One PR row as the scripts consume it: number, base ref, head label. */
type TargetRow = readonly [string, string, string];

/** Fixture wiring for one script execution. */
interface StepFixture {
  /** PR rows written to `targets.tsv`. */
  readonly targets: readonly TargetRow[];
  /** `behind_by` keyed by `<base>...<head>`; absent means unmeasurable. */
  readonly behind: Record<string, string>;
  /** PR numbers pre-seeded into `conflicted.txt`. */
  readonly conflicted?: readonly string[];
  /** Error text `update-branch` should fail with, keyed by PR number. */
  readonly updateFails?: Record<string, string>;
}

/** The outcome of executing one step's shell. */
interface StepResult {
  readonly status: number;
  readonly output: string;
  readonly tmp: string;
}

let workflow: ParsedWorkflow;
let steps: readonly Step[];

/**
 * Finds one step by its `name:`, failing loudly when it is absent.
 * @param name The step's declared name.
 * @returns The matching step.
 */
const stepNamed = (name: string): Step => {
  const found = steps.find(s => s.name === name);
  if (!found) throw new Error(`no step named ${name}`);
  return found;
};

/**
 * Renders the stub `gh` as a shell FUNCTION prepended to the step body.
 *
 * A function rather than an executable on a prepended PATH: shell functions win
 * name resolution over PATH lookup and are inherited by the subshells the step
 * uses, so the stub is reached without the harness rewriting PATH at all.
 *
 * It answers only the two calls the scripts make — `update-branch` and
 * `compare` — and looks both up in flat fixture files, so a head with no entry
 * prints nothing. That is the "could not measure" case the gate must treat as
 * a failure rather than a pass.
 * @param behindFile Path to the `<key>|<behind_by>` table.
 * @param failFile Path to the `<pr>|<error text>` table.
 * @returns The stub function's shell source.
 */
const ghStub = (behindFile: string, failFile: string): string =>
  [
    "gh() {",
    `  local BEHIND_FILE='${behindFile}'`,
    `  local FAIL_FILE='${failFile}'`,
    '  local ARGS="$*" pr msg key',
    '  if printf "%s" "$ARGS" | grep -q "update-branch"; then',
    '    pr=$(printf "%s" "$ARGS" | sed -E "s|.*/pulls/([0-9]+)/update-branch.*|\\1|")',
    '    msg=$(grep -E "^${pr}\\|" "$FAIL_FILE" 2>/dev/null | cut -d"|" -f2-)',
    '    if [ -n "$msg" ]; then echo "$msg" >&2; return 1; fi',
    '    echo "{\\"message\\":\\"Updating pull request branch.\\"}"',
    "    return 0",
    "  fi",
    '  if printf "%s" "$ARGS" | grep -q "/compare/"; then',
    '    key=$(printf "%s" "$ARGS" | sed -E "s|.*/compare/([^ ]+).*|\\1|")',
    '    grep -E "^${key}\\|" "$BEHIND_FILE" 2>/dev/null | cut -d"|" -f2',
    "    return 0",
    "  fi",
    "  return 0",
    "}",
  ].join("\n");

/**
 * Folds a bounded spawn's outcome into this suite's result shape.
 *
 * Both streams are joined because a step reports its verdict through workflow
 * commands on stdout and its diagnostics on stderr, and a case asserting the
 * gate failed needs to read both.
 * @param outcome What the bounded spawn returned.
 * @param outcome.status The child's exit status, or null when it was killed.
 * @param outcome.stdout Whatever the child wrote to stdout.
 * @param outcome.stderr Whatever the child wrote to stderr.
 * @param tmp The scratch directory the step ran against.
 * @returns The exit status, combined output, and that directory.
 */
const asResult = (
  outcome: { status: number | null; stdout?: string; stderr?: string },
  tmp: string
): StepResult => ({
  status: outcome.status ?? 1,
  output: `${outcome.stdout ?? ""}${outcome.stderr ?? ""}`,
  tmp,
});

/**
 * Serialises a fixture map into the stub's `key|value` table format.
 * @param table The fixture map.
 * @returns One `key|value` per line, newline terminated.
 */
const asTable = (table: Record<string, string>): string =>
  `${Object.entries(table)
    .map(([k, v]) => `${k}|${v}`)
    .join("\n")}\n`;

/**
 * Executes one step's `run:` body against the stubbed `gh`.
 * @param step The workflow step whose shell to execute.
 * @param fixture The fixture wiring for this execution.
 * @param fixture.targets PR rows written to `targets.tsv`.
 * @param fixture.behind `behind_by` keyed by `<base>...<head>`.
 * @param fixture.conflicted PR numbers pre-seeded into `conflicted.txt`.
 * @param fixture.updateFails Error text `update-branch` fails with, by PR.
 * @returns The exit status, combined output, and the scratch directory.
 */
const runStep = (step: Step, fixture: StepFixture): StepResult => {
  const { targets, behind, conflicted = [], updateFails = {} } = fixture;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-autoupdate-"));
  const behindFile = path.join(tmp, "behind.txt");
  const failFile = path.join(tmp, "updatefail.txt");
  const script = path.join(tmp, "step.sh");
  // GitHub expressions are not shell; no fixture below depends on one.
  const body = (step.run ?? "").replace(/\$\{\{[^}]*\}\}/g, "");
  const env = {
    ...process.env,
    RUNNER_TEMP: tmp,
    GITHUB_STEP_SUMMARY: path.join(tmp, "summary.md"),
    GITHUB_OUTPUT: path.join(tmp, "output.txt"),
    REPO: "acme/widget",
    GH_TOKEN: "stub",
    VERIFY_TIMEOUT: "0",
  };

  fs.writeFileSync(behindFile, asTable(behind));
  fs.writeFileSync(failFile, asTable(updateFails));
  fs.writeFileSync(
    path.join(tmp, "targets.tsv"),
    `${targets.map(r => r.join("\t")).join("\n")}\n`
  );
  fs.writeFileSync(
    path.join(tmp, "conflicted.txt"),
    `${conflicted.join("\n")}\n`
  );
  fs.writeFileSync(script, `${ghStub(behindFile, failFile)}\n${body}`);

  // `boundedSpawnSync` rather than `execFileSync`: it pairs the start with a
  // deadline, and it reports a non-zero exit as a `status` instead of throwing.
  // A non-zero exit is the expected result for half this suite — the gate
  // failing is the property under test — so it must be a value, not an
  // exception.
  return asResult(
    boundedSpawnSync({
      args: [script],
      command: BASH,
      env,
      label: `auto-update step: ${step.name ?? "unnamed"}`,
    }),
    tmp
  );
};

beforeAll(() => {
  workflow = yaml.load(fs.readFileSync(WORKFLOW, "utf8")) as ParsedWorkflow;
  steps = workflow.jobs[UPDATE_JOB]?.steps ?? [];
});

describe("auto-update dispatch handler: contract", () => {
  it("finds the job and its steps at all", () => {
    // The absent-case floor. Every assertion below derives from `steps`, so a
    // renamed job would make them all pass by asserting over nothing.
    expect(Object.keys(workflow.jobs)).toContain(UPDATE_JOB);
    expect(steps.length).toBeGreaterThanOrEqual(5);
  });

  it("updates PR branches with a script, never an LLM prompt", () => {
    const update = stepNamed(UPDATE_STEP);
    expect(update.run, "the update loop must be shell, not prose").toBeTruthy();
    expect(update.uses).toBeUndefined();
    expect(update.run).toContain("update-branch");
  });

  it("caps nothing on the update path with --max-turns", () => {
    // The strongest of the original four failure paths: a PR list long enough
    // to need a fourth turn was truncated by construction, invisibly.
    expect(JSON.stringify(stepNamed(UPDATE_STEP))).not.toContain("max-turns");
  });

  it("does not let the gate opt out of failing the job", () => {
    // `continue-on-error` on the gate is what made every prior run green.
    expect(stepNamed(VERIFY_STEP)["continue-on-error"]).toBeUndefined();
  });

  it("keeps the agent only for the conflict case", () => {
    const agent = steps.find(s =>
      s.uses?.startsWith("anthropics/claude-code-action")
    );
    expect(
      agent,
      "the agent should survive as a conflict fallback"
    ).toBeTruthy();
    expect(agent?.if).toContain("steps.update.outputs.conflicted");
  });

  it("verifies by measurement, and runs even when an earlier step failed", () => {
    const verify = stepNamed(VERIFY_STEP);
    expect(verify.if).toContain("always()");
    expect(verify.run).toContain("behind_by");
    expect(verify.run).toContain("compare");
  });

  it("resolves every steps.*.outputs reference it uses", () => {
    // The single-PR job referenced `steps.plugins.outputs.*` while having no
    // `plugins` step, so both values were empty on every single-PR run and
    // nothing said so. Assert the class of defect, not just that instance.
    const declared = new Set(steps.map(s => s.id).filter(Boolean));
    const referenced = new Set<string>();
    for (const m of JSON.stringify(steps).matchAll(
      /steps\.([A-Za-z0-9_-]+)\.outputs/g
    )) {
      referenced.add(m[1] ?? "");
    }
    expect(referenced.size).toBeGreaterThan(0);
    for (const id of referenced) {
      expect(declared, `steps.${id} is referenced`).toContain(id);
    }
  });

  it("paginates PR discovery instead of taking gh pr list's silent 30 cap", () => {
    expect(stepNamed(DISCOVER_STEP).run).toContain("--paginate");
  });
});

describe("auto-update dispatch handler: the gate actually fails", () => {
  const THREE: readonly TargetRow[] = [
    ["386", BASE, HEAD_A],
    ["387", BASE, HEAD_B],
    ["389", BASE, HEAD_C],
  ];
  const TWO_CURRENT = {
    [`${BASE}...${HEAD_A}`]: CURRENT,
    [`${BASE}...${HEAD_B}`]: CURRENT,
  };

  it("passes when every PR is current", () => {
    const r = runStep(stepNamed(VERIFY_STEP), {
      targets: THREE,
      behind: { ...TWO_CURRENT, [`${BASE}...${HEAD_C}`]: CURRENT },
    });
    expect(r.status).toBe(0);
    expect(r.output).toContain("All PR branches current");
  });

  it("FAILS, and names the PR, when one is left behind — the original defect", () => {
    // The exact shape of the reported run: two updated, one silently skipped,
    // handler green. It must now be red, and it must say which.
    const r = runStep(stepNamed(VERIFY_STEP), {
      targets: THREE,
      behind: { ...TWO_CURRENT, [`${BASE}...${HEAD_C}`]: "12" },
    });
    expect(r.status).toBe(1);
    expect(r.output).toContain("still behind after auto-update");
    expect(r.output).toContain("#389");
    expect(r.output).toContain("behind 12");
    expect(r.output).not.toContain("All PR branches current");
  });

  it("FAILS when freshness cannot be measured, rather than reading as a pass", () => {
    const r = runStep(stepNamed(VERIFY_STEP), {
      targets: THREE,
      behind: TWO_CURRENT,
    });
    expect(r.status).toBe(1);
    expect(r.output).toContain("not measurable");
    expect(r.output).toContain("#389");
  });

  it("reports a conflicted PR distinctly from a stale one, and does not fail on it", () => {
    const r = runStep(stepNamed(VERIFY_STEP), {
      targets: THREE,
      behind: { ...TWO_CURRENT, [`${BASE}...${HEAD_C}`]: "12" },
      conflicted: ["389"],
    });
    expect(r.status).toBe(0);
    expect(r.output).toContain("PRs left conflicted");
    expect(r.output).not.toContain("still behind after auto-update");
  });
});

describe("auto-update dispatch handler: outcomes are distinguished", () => {
  it("does not call update-branch for a PR that is already current", () => {
    // "already up to date" and "update failed" were one echo. They are now
    // different paths, and a current PR is never touched at all.
    const r = runStep(stepNamed(UPDATE_STEP), {
      targets: [["386", BASE, HEAD_A]],
      behind: { [`${BASE}...${HEAD_A}`]: CURRENT },
    });
    expect(r.status).toBe(0);
    expect(r.output).toContain("already current");
    expect(r.output).not.toContain("requesting update-branch");
  });

  it("records a conflict as a conflict, and a plain error as a warning", () => {
    const r = runStep(stepNamed(UPDATE_STEP), {
      targets: [
        ["386", BASE, HEAD_A],
        ["387", BASE, HEAD_B],
      ],
      behind: { [`${BASE}...${HEAD_A}`]: "3", [`${BASE}...${HEAD_B}`]: "4" },
      updateFails: {
        "386": "merge conflict between base and head",
        "387": "Not Found",
      },
    });
    expect(r.output).toContain("PR #386: server-side update conflicts");
    expect(r.output).toContain("::warning title=Update request failed");
    expect(r.output).toContain("#387");

    // The conflicted list gates the agent fallback, so it must hold exactly
    // the conflict — not the plain error, which no local merge fixes.
    const queued = fs
      .readFileSync(path.join(r.tmp, "conflicted.txt"), "utf8")
      .split("\n")
      .filter(Boolean);
    expect(queued).toEqual(["386"]);
  });
});
