/**
 * `package_manager` must reach a shell as a VARIABLE, never as source (#3793).
 *
 * A `${{ }}` expression is substituted into a `run:` body by Actions BEFORE
 * the shell parses it, so an interpolated value is shell source text rather
 * than an argument. `package_manager` is a free-text `type: string` input on
 * every reusable workflow here, so a caller passing `npm; <anything>` had the
 * second half executed — in command position in some steps, and inside the
 * `if [ "…" = "npm" ]` install chains in the rest, where a `"` closes the test
 * and the remainder is a new command.
 *
 * #3717 / #3792 fixed the same shape in `release.yml` and both copies of
 * `publish-to-npm.yml`. This is the rest of it: 113 interpolations across
 * eight reusable workflows, all reached by consumers at `@main`, so a change
 * here is live fleet-wide at merge.
 *
 * Four things about this test are deliberate.
 *
 * First, it EXECUTES the shipped `run:` bodies rather than grepping them. A
 * normal run still succeeds against the defect, so an acceptance case proves
 * nothing on its own.
 *
 * Second, it carries rejection controls — one per injection SITE SHAPE, since
 * the two shapes break out of the shell differently. Each is the pre-fix line
 * with Actions' substitution simulated, asserted to EXECUTE the payload.
 * Without them, "the payload does not fire" would also be satisfied by a
 * harness that silently failed to deliver a payload at all.
 *
 * Third, it proves the value arrives as ONE argv word: a package manager whose
 * name contains a space must be looked up as a single command, not split.
 *
 * Fourth, the reintroduction guard walks every workflow the repository ships —
 * not the eight this change touched — so a NEW workflow cannot reopen the
 * class. That guard is what fails when an interpolation comes back.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/integration/package-manager-injection
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

/** The shape of the parsed workflow this test reads. */
interface Workflow {
  readonly env?: Readonly<Record<string, string>>;
  readonly jobs: Readonly<
    Record<
      string,
      {
        readonly steps?: readonly {
          readonly name?: string;
          readonly run?: string;
        }[];
      }
    >
  >;
}

/**
 * Every workflow whose `package_manager` install step now fails closed, named
 * by the job and step whose shipped body this test executes.
 *
 * `release.yml` is absent on purpose: its install chain ends in
 * `else npm ci`, a deliberate default this change did not convert. It is
 * covered by the reintroduction guard and by the single-argv proof, not by the
 * allowlist cases.
 */
/** The two step names the shipped install steps use, verbatim. */
const INSTALL_PULL = "📥 Install dependencies";
const INSTALL_BOX = "📦 Install dependencies";
const INSTALL_PLAIN = "Install dependencies";

const GATED_INSTALLS: readonly (readonly [string, string, string])[] = [
  [".github/workflows/quality.yml", "lint", INSTALL_PULL],
  [".github/workflows/gates.yml", "gates", INSTALL_PULL],
  [".github/workflows/lighthouse.yml", "lighthouse", INSTALL_BOX],
  [".github/workflows/playwright-e2e.yml", "playwright_e2e", INSTALL_BOX],
  [".github/workflows/maestro-native-e2e.yml", "build", INSTALL_BOX],
  [".github/workflows/zap-baseline-expo.yml", "zap_baseline", INSTALL_PLAIN],
  [".github/workflows/zap-baseline-nestjs.yml", "zap_baseline", INSTALL_PLAIN],
];

/** A step that puts the package manager in COMMAND position. */
const LINT_STEP: readonly [string, string, string] = [
  ".github/workflows/quality.yml",
  "lint",
  "🧹 Run linter (oxlint + eslint)",
];

/**
 * Values that are shell syntax rather than a package manager. Each runs
 * `touch pwned` if it is ever treated as source rather than as a variable.
 *
 * The fourth closes the `[ "` of an install chain's test; the others are the
 * command-position shapes.
 */
const PAYLOADS: readonly string[] = [
  "npm; touch pwned",
  "npm$(touch pwned)",
  "npm`touch pwned`",
  'npm" ] ; touch pwned ; [ "x',
  "npm | touch pwned",
];

/** The allowlist every converted install step enforces. */
const ALLOWED: readonly string[] = ["npm", "yarn", "pnpm", "bun"];

/** Where the shipped workflows and the seeded stack templates live. */
const WORKFLOW_ROOTS: readonly string[] = [
  ".github/workflows",
  "all/create-only/.github/workflows",
  "cdk/create-only/.github/workflows",
  "expo/create-only/.github/workflows",
  "harper-fabric/copy-overwrite/.github/workflows",
  "harper-fabric/create-only/.github/workflows",
  "nestjs/create-only/.github/workflows",
  "npm-package/create-only/.github/workflows",
  "phaser/copy-overwrite/.github/workflows",
  "rails/create-only/.github/workflows",
  "typescript/create-only/.github/workflows",
];

/** Everything a run leaves behind, collected before its sandbox is removed. */
interface StepOutcome {
  readonly status: number;
  readonly stdout: string;
  /** Whether the payload's side effect fired — the injection actually ran. */
  readonly executed: boolean;
  /** One entry per argv word the stubbed package manager received. */
  readonly argv: readonly string[];
}

/**
 * Read one step's shipped `run:` body out of a workflow file.
 * @param workflowPath - Repository-relative workflow path
 * @param jobName - Job key in `jobs:`
 * @param stepName - The step's `name:`
 * @returns The step's script, exactly as it ships
 */
function stepBody(
  workflowPath: string,
  jobName: string,
  stepName: string
): string {
  const file = path.join(process.cwd(), workflowPath);
  const workflow = loadYaml(fs.readFileSync(file, "utf-8")) as Workflow;
  const step = workflow.jobs[jobName]?.steps?.find(s => s.name === stepName);
  if (step?.run === undefined)
    throw new Error(
      `step not found: ${workflowPath} / ${jobName} / ${stepName}`
    );
  return step.run;
}

/**
 * Run a script in a disposable sandbox and collect its observable effects.
 *
 * Every package manager on `PATH` is a stub that records argv, so a run
 * neither reaches the network nor needs a real project. The sandbox is removed
 * before returning — the suite's scratch-leak guard fails any fixture that
 * outlives the test that made it.
 * @param script - Shell script to execute
 * @param packageManager - The value bound to `PACKAGE_MANAGER`
 * @returns What the run produced
 */
function runStep(script: string, packageManager: string): StepOutcome {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-pm-injection-"));
  try {
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    for (const name of ["npm", "yarn", "pnpm", "bun", "corepack", "jq"]) {
      fs.writeFileSync(
        path.join(bin, name),
        '#!/bin/bash\nfor a in "$@"; do printf "%s\\n" "$a" >> "$ARGV_LOG"; done\n',
        { mode: 0o755 }
      );
    }

    const scriptPath = path.join(dir, "step.sh");
    fs.writeFileSync(scriptPath, script);
    const argvLog = path.join(dir, "argv");

    const outcome = boundedSpawnSync({
      command: "bash",
      args: [scriptPath],
      cwd: dir,
      label: "package_manager step body",
      env: {
        ...process.env,
        PACKAGE_MANAGER: packageManager,
        PATH: `${bin}:${process.env["PATH"] ?? ""}`,
        ARGV_LOG: argvLog,
        GITHUB_OUTPUT: path.join(dir, "github_output"),
        GITHUB_STEP_SUMMARY: path.join(dir, "step_summary"),
      },
    });

    return {
      status: outcome.status ?? -1,
      stdout: outcome.stdout,
      executed: fs.existsSync(path.join(dir, "pwned")),
      argv: fs.existsSync(argvLog)
        ? fs.readFileSync(argvLog, "utf-8").split("\n").filter(Boolean)
        : [],
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe.each(GATED_INSTALLS)(
  "%s / %s / %s fails closed on anything outside the allowlist",
  (workflowPath, jobName, stepName) => {
    const body = (): string => stepBody(workflowPath, jobName, stepName);

    it.each(ALLOWED)("accepts %s", manager => {
      expect(runStep(body(), manager).status).toBe(0);
    });

    it.each(PAYLOADS)("refuses %j without executing it", payload => {
      const result = runStep(body(), payload);

      expect(result.executed).toBe(false);
      expect(result.status).not.toBe(0);
    });

    it("names the allowlist when it refuses", () => {
      const result = runStep(body(), "npm; touch pwned");

      expect(result.stdout).toContain(
        "package_manager must be one of npm, yarn, pnpm, bun"
      );
    });
  }
);

describe("a package manager in command position arrives as one argv word", () => {
  const body = (): string => stepBody(...LINT_STEP);

  it("passes the script name through to the package manager", () => {
    const result = runStep(body(), "bun");

    expect(result.status).toBe(0);
    expect(result.argv).toEqual(["run", "lint"]);
  });

  it("looks up a two-word name as ONE command rather than splitting it", () => {
    // `bun run` would be a valid command line if the value were source text.
    // As a variable it is a single, non-existent command name.
    const result = runStep(body(), "bun run");

    expect(result.status).toBe(127);
    expect(result.argv).toEqual([]);
  });

  it.each(PAYLOADS)("refuses %j without executing it", payload => {
    const result = runStep(body(), payload);

    expect(result.executed).toBe(false);
    expect(result.status).not.toBe(0);
  });
});

describe("rejection controls", () => {
  it("proves a payload acts on the pre-fix command-position line", () => {
    // `run: ${{ inputs.package_manager }} run lint`, with Actions'
    // substitution of a hostile value performed the way Actions performs it.
    const result = runStep("npm; touch pwned run lint", "unused");

    expect(result.executed).toBe(true);
  });

  it("proves a payload acts on the pre-fix install chain", () => {
    // The first line of the shipped install chain, pre-fix:
    // `if [ "${{ inputs.package_manager }}" = "npm" ]; then`.
    const result = runStep(
      'if [ "npm" ] ; touch pwned ; [ "x" = "npm" ]; then\n  :\nfi\n',
      "unused"
    );

    expect(result.executed).toBe(true);
  });
});

describe("no workflow interpolates package_manager into a run body", () => {
  const workflows = WORKFLOW_ROOTS.flatMap(root => {
    const dir = path.join(process.cwd(), root);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter(name => name.endsWith(".yml") || name.endsWith(".yaml"))
      .map(name => path.join(root, name));
  });

  it("finds workflows to check", () => {
    expect(workflows.length).toBeGreaterThan(50);
  });

  it.each(workflows)("%s", workflowPath => {
    const file = path.join(process.cwd(), workflowPath);
    const workflow = loadYaml(fs.readFileSync(file, "utf-8")) as Workflow;
    const offenders: string[] = [];

    for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        if (
          typeof step.run === "string" &&
          /\$\{\{[^}]*package_manager/u.test(step.run)
        ) {
          offenders.push(`${jobName} / ${step.name ?? "(unnamed step)"}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
