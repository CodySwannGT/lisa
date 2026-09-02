/**
 * The runner executes the prover the project ships, and says which one it was.
 *
 * `resolveMoment` learned to fall back to `shippedAs` in #2916, but a resolver
 * nothing calls with the project's manifest resolves nothing differently. This
 * file pins the wiring: the runner reads `package.json`, hands the scripts to
 * the resolver, and runs whatever came back.
 *
 * The two fail-closed controls matter as much as the substitution. Eight
 * green-but-inert guards were found here in one day, and the mirror-image
 * defect of an inert guard is one that resolves MORE than it should — a gate
 * with no prover anywhere quietly acquiring a command, or a project's own
 * `run:` being second-guessed. Both are asserted below by outcome, not by
 * inspection of the resolver.
 * @module tests/unit/scripts/lisa-run-gates-shipped-as
 */

import { describe, expect, it } from "vitest";

import {
  runGates,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  type GateRun,
  RUNNER,
  sink,
  stubExec,
} from "./lisa-run-gates-fixtures.js";

/** The deploy moment the three blocked gates are legal at. */
const DEPLOY = "pre-deploy:production";

/** The gates #2832 cannot run because their default resolves nowhere. */
const DAST = "runtime-web-vulnerability";
const LOAD = "load-capacity";
const A11Y = "accessibility";

/** What a nestjs project's manifest offers for those three concerns. */
const NESTJS_SCRIPTS = Object.freeze({
  "security:zap": "zap-baseline.py -t http://localhost:3000",
  "k6:load": "k6 run load.js",
});

/**
 * Run a gates block at the production deploy moment.
 * @param options - Run inputs
 * @param options.gates - The gates block
 * @param options.scripts - The project's package scripts, or null
 * @param options.codes - Exit code per command
 * @returns The run, the commands executed, and the printed lines
 */
function run(options: {
  gates: Record<string, unknown>;
  scripts?: Record<string, string> | null;
  codes?: Record<string, number | null>;
}): { result: GateRun; calls: string[]; lines: string[] } {
  const { gates, scripts = null, codes = {} } = options;
  const { exec, calls } = stubExec(codes);
  const { lines, out } = sink();
  const result = runGates({
    gates,
    moment: DEPLOY,
    runner: RUNNER,
    exec,
    out,
    scripts,
  }) as GateRun;
  return { result, calls, lines };
}

describe("the runner executes the prover the project actually ships", () => {
  it("runs security:zap and k6:load rather than two missing scripts", () => {
    const { calls } = run({
      gates: {
        [DAST]: { [DEPLOY]: "required" },
        [LOAD]: { [DEPLOY]: "required" },
      },
      scripts: NESTJS_SCRIPTS,
    });

    // Order is the runner's cheap-before-costly rule, not this case's subject:
    // `load-capacity` is marked `costly`, `dast` is not.
    expect(calls).toEqual(["bun run security:zap", "bun run k6:load"]);
  });

  it("names both scripts in the line, so nobody has to read the registry", () => {
    const { lines } = run({
      gates: { [DAST]: { [DEPLOY]: "required" } },
      scripts: NESTJS_SCRIPTS,
    });
    const line = lines.find(entry => entry.includes(DAST)) ?? "";

    expect(line).toContain("security:zap");
    expect(line).toContain("security:dast");
  });
});

describe("a gate with no prover anywhere still fails closed", () => {
  it("reports FAILED and blocks when the only script named is missing", () => {
    // The positive control for the substitution above. `accessibility` carries
    // no alias, so the runner must still execute its concern name and read the
    // package manager's `Missing script` exit code as a failure.
    const { result, calls } = run({
      gates: { [A11Y]: { [DEPLOY]: "required" } },
      scripts: NESTJS_SCRIPTS,
      codes: { "bun run a11y:check": 1 },
    });

    expect(calls).toEqual(["bun run a11y:check"]);
    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe(A11Y);
    expect(result.results[0]?.state).toBe(STATE.FAILED);
  });

  it("still fails closed for an aliased gate whose alias is absent too", () => {
    const { result, calls } = run({
      gates: { [LOAD]: { [DEPLOY]: "required" } },
      scripts: { lint: "oxlint" },
      codes: { "bun run perf:load": 1 },
    });

    expect(calls).toEqual(["bun run perf:load"]);
    expect(result.blockedBy).toBe(LOAD);
  });
});

describe("a project that named its own prover keeps it", () => {
  it("runs the declared task even where an alias would have resolved", () => {
    const { calls } = run({
      gates: { [DAST]: { [DEPLOY]: { level: "required", run: "scan:mine" } } },
      scripts: NESTJS_SCRIPTS,
    });

    expect(calls).toEqual(["bun run scan:mine"]);
  });
});
