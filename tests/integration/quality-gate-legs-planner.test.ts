/**
 * The gate-leg planner, EXECUTED rather than read.
 *
 * `gate_legs` decides which legs exist, so what it does when it CANNOT decide
 * is the whole safety property. Answering "none" whenever it could not answer
 * at all would silently stop every declared gate reporting — and a required
 * context that never reports does not read as skipped, it holds the pull
 * request at "Expected — Waiting for status to be reported" forever. That is
 * #2842's shape: a job that skips its proving step reports green.
 *
 * So this suite lifts the step's own `run:` body out of `quality.yml` and runs
 * it in a scratch directory against four resolvers. Reading the YAML proves
 * the branches are written; running it proves which one fires.
 *
 * | resolver | answer |
 * | --- | --- |
 * | absent | empty, warning, PASS — nothing could have been declared |
 * | too old to know `legs` | empty, warning, PASS — told apart by `list` |
 * | present and broken | FAIL — it said nothing, not "no gates" |
 * | present, answer malformed | FAIL, separately, so corrupt never reads old |
 *
 * The old-resolver row is a real population, not a hypothetical: consumers
 * call this workflow at `@main` while holding whatever copy of
 * `lisa-gates.mjs` their last install put there. Its fixture reproduces what
 * the resolver did one commit before the `legs` command existed — `legs` exits
 * 1 with a usage line, `list` exits 0.
 * @module tests/integration/quality-gate-legs-planner
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as yaml from "js-yaml";
import { afterAll, describe, expect, it } from "vitest";

import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../helpers/io-latency-budget.js";

/** The workflow whose planner step this suite executes. */
const WORKFLOW = path.join(
  process.cwd(),
  ".github",
  "workflows",
  "quality.yml"
);

/** One step, as this suite reads it. */
interface Step {
  id?: string;
  run?: string;
}

/** The parsed workflow, narrowed to what this suite needs. */
const JOBS = (
  yaml.load(fs.readFileSync(WORKFLOW, "utf8")) as {
    jobs: Record<string, { steps?: Step[] }>;
  }
).jobs;

/** Scratch directories this suite creates, removed together at the end. */
const SCRATCH: string[] = [];

afterAll(() => {
  for (const dir of SCRATCH) fs.rmSync(dir, { recursive: true, force: true });
});

/** The `run:` body of the planner step, executed by the cases below. */
const PLANNER = (() => {
  const step = JOBS["gate_legs"]?.steps?.find(entry => entry.id === "legs");
  if (step?.run === undefined) throw new Error("planner step not found");
  return step.run;
})();

/**
 * Lay out a scratch checkout the planner step can be run inside.
 * @param resolver - Body of `scripts/lisa-gates.mjs`, or null to omit it.
 * @returns The directory, the captured `GITHUB_OUTPUT` file, and the script.
 */
function plannerScratch(resolver: string | null): {
  outputFile: string;
  script: string;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-gate-legs-"));
  const outputFile = path.join(dir, "github-output");
  const script = path.join(dir, "step.sh");
  const scriptsDir = path.join(dir, "scripts");
  SCRATCH.push(dir);
  fs.writeFileSync(outputFile, "");
  fs.writeFileSync(script, PLANNER);
  if (resolver !== null) {
    fs.mkdirSync(scriptsDir);
    fs.writeFileSync(path.join(scriptsDir, "lisa-gates.mjs"), resolver);
  }
  return { outputFile, script };
}

/**
 * One `key=value` line, as the step wrote it to `GITHUB_OUTPUT`.
 * @param emitted - The whole captured file
 * @param key - Output name to read
 * @returns The value, or the empty string when the key was never written
 */
function outputValue(emitted: string, key: string): string {
  return new RegExp(`^${key}=(.*)$`, "mu").exec(emitted)?.[1] ?? "";
}

/**
 * Run the planner step in a scratch directory and report what it decided.
 * @param resolver - Body of `scripts/lisa-gates.mjs`, or null to omit it.
 * @returns Exit status, the `legs`/`count` outputs, and the step's own log.
 */
function runPlanner(resolver: string | null): {
  status: number;
  legs: string;
  count: string;
  log: string;
} {
  const { outputFile, script } = plannerScratch(resolver);
  const outcome = boundedSpawnSync({
    label: `gate_legs planner (${resolver === null ? "absent" : "present"})`,
    command: "bash",
    args: [script],
    cwd: path.dirname(script),
    env: {
      ...process.env,
      GATE_MOMENT: "pull-request",
      GITHUB_OUTPUT: outputFile,
    },
  });
  const emitted = fs.readFileSync(outputFile, "utf8");
  return {
    status: outcome.status ?? 1,
    legs: outputValue(emitted, "legs"),
    count: outputValue(emitted, "count"),
    log: `${outcome.stdout ?? ""}${outcome.stderr ?? ""}`,
  };
}

/**
 * A stand-in resolver that answers with whatever JSON it is handed.
 * @param json - The exact text the fake resolver writes to stdout
 * @returns Source for a `scripts/lisa-gates.mjs` that prints it
 */
const answering = (json: string): string =>
  `process.stdout.write(${JSON.stringify(json)} + "\\n");\n`;

describe("the planner is loud when it cannot answer, and quiet only when there is nothing to answer", () => {
  it("emits no legs and passes when the project ships no registry at all", () => {
    // There is nothing such a project could have declared, so there is no leg
    // it can be missing, and every property it proves today is proved by a
    // hand-written job exactly as before.
    const result = runPlanner(null);
    expect(result.status).toBe(0);
    expect(result.legs).toBe("[]");
    expect(result.count).toBe("0");
    expect(result.log).toContain("::warning::");
  });

  it("passes with a warning when the registry is too OLD to know the command", () => {
    // A REAL POPULATION, not a hypothetical: consumers call this workflow at
    // `@main` while holding whatever copy of `lisa-gates.mjs` their last `lisa`
    // run installed. Measured against the resolver as it stood before this
    // change — `legs` exits 1 with a usage line, `list` exits 0 — which is
    // exactly the pair this branch reads.
    const result = runPlanner(
      "const [command] = process.argv.slice(2);\n" +
        'if (command === "list") { process.stdout.write("[]\\n"); process.exit(0); }\n' +
        'process.stderr.write("usage: lisa-gates.mjs validate|list\\n");\n' +
        "process.exit(1);\n"
    );
    expect(result.status).toBe(0);
    expect(result.legs).toBe("[]");
    expect(result.count).toBe("0");
    expect(result.log).toContain("::warning::");
    expect(result.log).not.toContain("::error::");
  });

  it("FAILS when the registry is installed and cannot resolve", () => {
    // THE BITE. Treating this as an empty list is the #2842 shape: every
    // declared gate stops reporting, and a required context that never reports
    // holds the pull request open rather than passing it. Absent is not a skip.
    const result = runPlanner("process.exit(1);\n");
    expect(result.status).toBe(1);
    expect(result.log).toContain("::error::");
  });

  it("FAILS on a leg list that is not a list", () => {
    const result = runPlanner(answering('{"gate":"code-style"}'));
    expect(result.status).toBe(1);
  });

  it("FAILS on a task that could reach the shell as more than a word", () => {
    // A second refusal, deliberately duplicating `momentLegs`. A consumer may
    // be running an older resolver whose `legs` output this workflow has never
    // seen, so the workflow re-checks rather than trusting.
    const result = runPlanner(
      answering(
        JSON.stringify([
          {
            gate: "x-evil",
            label: "🧨 Evil",
            level: "required",
            action: "run",
            runner: "npm run",
            task: "lint; curl evil",
            install: true,
            timeout: 15,
            summary: "",
          },
        ])
      )
    );
    expect(result.status).toBe(1);
  });

  it("FAILS on a runner that is a shell no-op", () => {
    const result = runPlanner(
      answering(
        JSON.stringify([
          {
            gate: "x-quiet",
            label: "🤫 Quiet",
            level: "required",
            action: "run",
            runner: ":",
            task: "lint",
            install: true,
            timeout: 15,
            summary: "",
          },
        ])
      )
    );
    expect(result.status).toBe(1);
  });

  it("FAILS when two legs would post one context", () => {
    const leg = {
      gate: "x-one",
      label: "🧿 Same",
      level: "required",
      action: "report",
      runner: "",
      task: "",
      install: false,
      timeout: 15,
      summary: "",
    };
    const result = runPlanner(
      answering(JSON.stringify([leg, { ...leg, gate: "x-two" }]))
    );
    expect(result.status).toBe(1);
  });

  it("passes a well-formed leg list through, with its count", () => {
    const result = runPlanner(
      answering(
        JSON.stringify([
          {
            gate: "artifact-freshness",
            label: "🧾 Generated Artifacts",
            level: "required",
            action: "run",
            runner: "bun run",
            task: "check:artifacts",
            install: true,
            timeout: 15,
            summary: "",
          },
        ])
      )
    );
    expect(result.status).toBe(0);
    expect(result.count).toBe("1");
    expect(JSON.parse(result.legs)).toHaveLength(1);
  });

  it("keeps the leg list on ONE line, because a job output is one line", () => {
    // A pretty-printed array arrives at `fromJSON()` truncated at its first
    // newline, and the failure reads as a malformed registry rather than as a
    // formatting choice.
    const emitted = boundedExecFileSync({
      label: "lisa-gates.mjs legs --json",
      command: "node",
      args: [
        path.join(
          process.cwd(),
          "all",
          "copy-overwrite",
          "scripts",
          "lisa-gates.mjs"
        ),
        "legs",
        "--moment=pull-request",
        "--json",
      ],
      cwd: process.cwd(),
    });
    expect(emitted.trimEnd()).not.toContain("\n");
  });
});
