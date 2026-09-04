/**
 * Wiring for the mutation gate — the ways it could report success while doing
 * nothing.
 *
 * The gate exists because eight controls were found green while checking
 * nothing, so the first thing to prove about it is that it is not a ninth. Each
 * assertion here names one route to a vacuous pass:
 *
 * - the CI job greps `package.json` for the literal `"test:mutation"` and prints
 *   a skip notice when it is absent, so a renamed script silently disarms it;
 * - `thresholds.break` at `0` or `null` is a gate that can never fail;
 * - a mutate entry pointing at a path that no longer exists mutates nothing;
 * - a guard no suite reaches contributes only denominator, and the aggregate can
 *   still clear the floor while that guard has no test with teeth at all;
 * - and the whole file is only ratcheted because `stryker.conf.json` at the
 *   repository root is what the `stryker` family matches.
 *
 * The gate can still FAIL for real — `tests/integration/mutation-gate-bite`
 * withholds a guard's suite and watches it go red. That is the other half.
 * @module tests/unit/scripts/mutation-gate-wiring
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { compareFile } from "../../../plugins/src/base/hooks/threshold-ratchet-compare.mjs";
import { familyFor } from "../../../plugins/src/base/hooks/threshold-ratchet-families.mjs";
import yaml from "js-yaml";

import * as gate from "../../../typescript/copy-overwrite/scripts/lisa-mutation.mjs";
import {
  QUALITY_JOB_GATES,
  SKIP_JOB_TOKENS,
  gateForSkipJob,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  mutatedGuards,
  scopedGuards,
  suitesByGuard,
  suitesReachingGuards,
} from "../../../vitest.config.mutation";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const CONF_REL = "stryker.conf.json";

/** The gate source, read for the every-exit-is-named assertion (#3668). */
const GATE_SOURCE = path.join(
  ROOT,
  "typescript",
  "copy-overwrite",
  "scripts",
  "lisa-mutation.mjs"
);

/** Exact wrapper plus registered nested mutation scratch prefixes. */
const MUTATION_COMMAND =
  'LISA_TEST_SCRATCH_PREFIXES=\'["lisa-mutation-","worker-"]\' ' +
  "$npm_execpath run lisa-test-run -- --adapter direct -- " +
  "node scripts/lisa-mutation.mjs";

/** Stack templates whose mutation payload starts nested Vitest workers. */
const MUTATION_STACKS = [
  "typescript",
  "npm-package",
  "nestjs",
  "cdk",
  "harper-fabric",
  "phaser",
  "expo",
] as const;

/** The committed Stryker configuration. */
const conf = JSON.parse(fs.readFileSync(path.join(ROOT, CONF_REL), "utf8")) as {
  readonly mutate: readonly string[];
  readonly thresholds: { readonly break: number };
  readonly vitest: { readonly configFile: string };
};

/** The repository's own package manifest. */
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
) as {
  readonly scripts: Record<string, string>;
  readonly devDependencies: Record<string, string>;
};

describe("mutation gate wiring", () => {
  it("keeps the script name the CI job greps for", () => {
    // .github/workflows/quality.yml `test_mutation` → "Check for test:mutation
    // script": `grep -q '"test:mutation"' package.json`. A miss is a skip
    // notice and a green job, not a failure.
    expect(manifest.scripts["test:mutation"]).toBe(MUTATION_COMMAND);
  });

  it("runs the diff-only gate Lisa ships, not a variant of it", () => {
    // The dogfood property. `test:mutation` used to be a bare `stryker run`
    // here while every consumer got `node scripts/lisa-mutation.mjs` under a
    // `force` pin — so the one repository able to notice a defect in the
    // shipped gate was the one repository not running it.
    const entrypoint = fs.readFileSync(
      path.join(ROOT, "scripts", "lisa-mutation.mjs"),
      "utf8"
    );
    expect(entrypoint).toContain(
      "../typescript/copy-overwrite/scripts/lisa-mutation.mjs"
    );
    expect(manifest.scripts["test:mutation"]).toContain(
      "scripts/lisa-mutation.mjs"
    );
  });

  it("keeps a way to reproduce the full-run measurement the floor came from", () => {
    // `thresholds.break` is a measured whole-list score. Without a committed
    // command that reproduces that measurement, the number becomes folklore.
    //
    // It runs through the SHIPPED gate rather than invoking `stryker run`
    // directly, and that is the same dogfood property `test:mutation` carries
    // one line up. A bare `stryker run` bypassed the gate entirely — and with
    // it the timeout accounting, on the one run big enough for the timeout
    // bucket to be worth anything (CodySwannGT/lisa#2989).
    expect(manifest.scripts["test:mutation:full"]).toBe(
      `${MUTATION_COMMAND} --all`
    );
    expect(manifest.scripts["test:mutation:full"]).toContain(
      "scripts/lisa-mutation.mjs"
    );
  });

  it.each(MUTATION_STACKS)(
    "registers nested mutation workers for the %s stack",
    stack => {
      const stackManifest = JSON.parse(
        fs.readFileSync(
          path.join(ROOT, stack, "package-lisa", "package.lisa.json"),
          "utf8"
        )
      ) as { readonly force: { readonly scripts: Record<string, string> } };
      expect(stackManifest.force.scripts["test:mutation"]).toBe(
        `LISA_TEST_SCRATCH_PREFIXES='["lisa-mutation-","worker-"]' ` +
          `lisa-test-run --profile ${stack} --adapter direct -- ` +
          `node scripts/lisa-mutation.mjs`
      );
    }
  );

  it("preserves the wrapper's exact nested-worker prefix registry", async () => {
    const variable = "LISA_TEST_SCRATCH_PREFIXES";
    const saved = process.env[variable];
    const expected = JSON.stringify(["lisa-mutation-", "worker-"]);
    try {
      process.env[variable] = expected;
      vi.resetModules();
      const { default: localConfig } =
        await import("../../../vitest.config.local");
      const environment = localConfig.test?.env as
        | Record<string, string>
        | undefined;
      expect(environment?.[variable]).toBe(expected);
    } finally {
      if (saved === undefined) delete process.env[variable];
      else process.env[variable] = saved;
      vi.resetModules();
    }
  });

  it("has the gate switched on, so the shipped self-skip cannot hide it", () => {
    // `mutation.gate.json` defaults to `"enabled": false` and the gate then
    // prints a notice and exits 0. That default is right for a consumer
    // adopting Lisa and wrong for Lisa: a gate that self-skips in the
    // repository that ships it proves exactly nothing about it.
    const gate = JSON.parse(
      fs.readFileSync(path.join(ROOT, "mutation.gate.json"), "utf8")
    ) as { readonly enabled: boolean; readonly since: string };
    expect(gate.enabled).toBe(true);
    expect(gate.since).toBe("main");
  });

  it("mutates the gate script itself", () => {
    // The wrapper decides what gets mutated, so a defect in it disables
    // everything downstream of it silently. It is in the mutate list for the
    // same reason the guards are.
    expect(mutatedGuards()).toContain(
      "typescript/copy-overwrite/scripts/lisa-mutation.mjs"
    );
  });

  it("declares the runner the gate needs", () => {
    expect(manifest.devDependencies["@stryker-mutator/core"]).toBeTruthy();
    expect(
      manifest.devDependencies["@stryker-mutator/vitest-runner"]
    ).toBeTruthy();
  });

  it("puts the config where the threshold ratchet watches it", () => {
    expect(familyFor(CONF_REL)?.id).toBe("stryker");
  });

  it("sets a break threshold that can actually fail a run", () => {
    expect(typeof conf.thresholds.break).toBe("number");
    expect(conf.thresholds.break).toBeGreaterThan(0);
  });

  it("points at the narrowed vitest config, not the full suite", () => {
    expect(conf.vitest.configFile).toBe("vitest.config.mutation.ts");
    expect(fs.existsSync(path.join(ROOT, conf.vitest.configFile))).toBe(true);
  });

  it("names only guard scripts that exist", () => {
    expect(mutatedGuards().length).toBeGreaterThan(0);
    for (const guard of mutatedGuards()) {
      expect(fs.existsSync(path.join(ROOT, guard)), guard).toBe(true);
    }
  });

  it("gives every mutated guard at least one suite that reaches it", () => {
    // The silent-green case in miniature. A guard with no reaching suite has
    // every mutant reported uncovered; it drags the aggregate but proves
    // nothing, and nothing else in the run would say so.
    for (const [guard, suites] of suitesByGuard()) {
      expect(
        suites,
        `${guard} is mutated but no unit suite imports it`
      ).not.toHaveLength(0);
    }
  });

  it("keeps every behavioural destructive-guard suite inside the derived list", () => {
    // A guard with ONE reaching suite passes the check above while most of it
    // goes unmutated, and the aggregate hides that: the whole-list score was
    // 53.62 against a floor of 32 while `lisa-destructive-guard.mjs` sat at
    // 19.61, with 120 of its 153 mutants reported uncovered. Two of its three
    // suites reached it through `import()` of a URL assembled at runtime,
    // which Vite's module graph — and therefore this resolver and Stryker's
    // related-files filter — cannot see, so the gate ran without them and said
    // nothing (#2844).
    //
    // A count rather than a roster of filenames, deliberately: the bite test
    // records what a hardcoded filename costs. It only ever ratchets up, and
    // converting any of the three back to a runtime import fails here by name.
    // The remaining suite over this guard, `destructive-guard-source-shape`,
    // is correctly ABSENT: it asserts the guard's bytes rather than calling it,
    // and a file cannot be both mutated and byte-asserted in the same run.
    expect(
      suitesByGuard().get(
        "all/copy-overwrite/scripts/lisa-destructive-guard.mjs"
      ),
      "a suite that reaches the guard through a runtime import() is invisible to the gate"
    ).toHaveLength(4);
  });

  it("refuses a lowered floor through the existing ratchet", () => {
    // The floor only means anything if it cannot be nudged. Asserted against
    // the committed file rather than a fixture, so it stays true of whatever
    // `thresholds.break` currently is. `compareFile` cannot report this until
    // the config exists on the base side, which is why it is proved here rather
    // than by running the ratchet CLI against a base that predates the gate.
    const current = fs.readFileSync(path.join(ROOT, CONF_REL), "utf8");
    const lowered = JSON.stringify({
      ...conf,
      thresholds: { ...conf.thresholds, break: conf.thresholds.break - 1 },
    });
    const findings = compareFile(CONF_REL, current, lowered);
    expect(findings.map((f: { type: string }) => f.type)).toContain("weakened");
  });

  it("refuses dropping a guard from the mutate list", () => {
    const current = fs.readFileSync(path.join(ROOT, CONF_REL), "utf8");
    const shrunk = JSON.stringify({ ...conf, mutate: conf.mutate.slice(1) });
    const findings = compareFile(CONF_REL, current, shrunk);
    expect(findings.map((f: { type: string }) => f.type)).toContain(
      "exemption-added"
    );
  });

  it("derives the suite list rather than hard-coding it", () => {
    const derived = suitesReachingGuards();
    expect(derived.length).toBeGreaterThan(0);
    for (const suite of derived) {
      expect(fs.existsSync(path.join(ROOT, suite)), suite).toBe(true);
    }
  });

  it("uses a line-ranged mutation scope to narrow the dry-run suites", () => {
    const saved = process.env.MUTATION_SCOPE;
    const guard = "all/copy-overwrite/scripts/lisa-destructive-guard.mjs";
    try {
      process.env.MUTATION_SCOPE = `${guard}:7-12`;
      expect(scopedGuards()).toEqual([guard]);
    } finally {
      if (saved === undefined) delete process.env.MUTATION_SCOPE;
      else process.env.MUTATION_SCOPE = saved;
    }
  });
});

describe("a run that measured NOTHING must not render as a pass (#3668)", () => {
  // MEASURED on #3664, this repository, 2026-09-03. A 400-line change to a
  // shipped guard script produced:
  //
  //   ⚪ mutation-gate: nothing-to-mutate
  //      7 file(s) changed vs main; 0 of them are mutate targets
  //
  //   🔍 Quality Checks / 🧬 Mutation Testing Gate   pass
  //
  // The log was honest and the check was not — and the file had said so above
  // `OUTCOMES` for months: "both exit 0, and only the marker says which one
  // happened." A marker in a log is not a control.

  it("keeps `nothing-to-mutate` and `no-current-lines` DISTINCT", () => {
    // #3333 owns the routing between these two; this issue owns how they
    // render. They are different facts with different remedies — 0 of the
    // changed files are mutate targets, versus mutate targets changed but
    // their diff has no current lines to place a mutant on — and a reader who
    // assumed one name covered both would look for the wrong fix.
    expect(gate.OUTCOMES.nothingToMutate).not.toBe(
      gate.OUTCOMES.noCurrentLines
    );
  });

  it("derives measurement from the concrete report, not the outcome name", () => {
    const unmeasured = gate.reportRun(ROOT, {
      code: 1,
      output: "DryRunExecutor timed out before a score was produced",
    });
    const killed = gate.reportRun(ROOT, {
      code: 1,
      output: null,
      killedBy: "child-deadline",
    });
    const measured = gate.reportRun(ROOT, {
      code: 0,
      output: [
        "-----------|------------------|----------|-----------|------------|----------|----------|",
        "           | % Mutation score |          |           |            |          |          |",
        "File       |  total | covered | # killed | # timeout | # survived | # no cov | # errors |",
        "-----------|--------|---------|----------|-----------|------------|----------|----------|",
        "All files  |  100.00 |   100.00 |     1 |       0 |       0 |     0 |      0 |",
        "-----------|--------|---------|----------|-----------|------------|----------|----------|",
      ].join("\n"),
    });

    expect(unmeasured.measured).toBe(false);
    expect(killed.measured).toBe(false);
    expect(measured.measured).toBe(true);
    expect(unmeasured.code).toBe(1);
    expect(killed.code).toBe(1);
    expect(measured.code).toBe(0);
  });

  it("names its outcome at EVERY exit, and returns the code untouched", () => {
    // Removed rather than left for the scratch-leak guard to find: this suite
    // is about a control that reports success while doing nothing, and leaving
    // debris that reddens somebody else's later run would be a small instance
    // of the same disease.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mutation-outcome-"));
    try {
      const output = path.join(scratch, "out.txt");

      expect(
        gate.finish(gate.OUTCOMES.nothingToMutate, 0, false, {
          GITHUB_OUTPUT: output,
        })
      ).toBe(0);
      expect(
        gate.finish(gate.OUTCOMES.scoped, 1, true, {
          GITHUB_OUTPUT: output,
        })
      ).toBe(1);

      const written = fs.readFileSync(output, "utf8");
      expect(written).toBe(
        `mutation_outcome=${gate.OUTCOMES.nothingToMutate}\n` +
          `mutation_measured=false\n` +
          `mutation_outcome=${gate.OUTCOMES.scoped}\n` +
          `mutation_measured=true\n`
      );
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("never lets a missing output destination change the exit code", () => {
    // Reporting, downstream of a verdict already reached. Losing the render
    // must not invert the code the gate worked to earn.
    expect(gate.finish(gate.OUTCOMES.scoped, 7, false, {})).toBe(7);
    expect(
      gate.finish(gate.OUTCOMES.scoped, 7, false, { GITHUB_OUTPUT: "" })
    ).toBe(7);
  });

  it("defaults an outcome with no concrete report to unmeasured", () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mutation-default-"));
    const saved = process.env.GITHUB_OUTPUT;
    try {
      const output = path.join(scratch, "out.txt");
      process.env.GITHUB_OUTPUT = output;

      expect(gate.finish(gate.OUTCOMES.nothingToMutate, 0)).toBe(0);
      expect(fs.readFileSync(output, "utf8")).toBe(
        `mutation_outcome=${gate.OUTCOMES.nothingToMutate}\n` +
          "mutation_measured=false\n"
      );
    } finally {
      if (saved === undefined) delete process.env.GITHUB_OUTPUT;
      else process.env.GITHUB_OUTPUT = saved;
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("routes EVERY exit in runGate through finish, with no bare return", () => {
    // The property worth more than the plumbing: an exit that forgets to name
    // its outcome is now impossible to write rather than merely discouraged.
    // Asserted against the source because it is a claim about every branch,
    // including the ones no fixture in this suite reaches.
    const source = fs.readFileSync(GATE_SOURCE, "utf8");
    const body = source.slice(source.indexOf("export const runGate ="));
    const exits = body
      .slice(0, body.indexOf("\n};"))
      .match(/^\s*return .*$/gmu);

    expect(exits).not.toBeNull();
    expect(exits?.length).toBeGreaterThan(5);
    for (const exit of exits ?? []) {
      expect(exit, `unnamed exit: ${exit.trim()}`).toContain("finish(");
    }
  });
});

describe("the renderer job, and why its ABSENCE is the signal (#3668)", () => {
  /** `quality.yml`, parsed once for the job-topology assertions. */
  const quality = yaml.load(
    fs.readFileSync(
      path.join(ROOT, ".github", "workflows", "quality.yml"),
      "utf8"
    )
  ) as {
    readonly jobs: Record<
      string,
      {
        readonly name?: string;
        readonly needs?: readonly string[];
        readonly if?: string;
        readonly outputs?: Record<string, string>;
        readonly permissions?: Record<string, string>;
        readonly steps?: readonly { readonly id?: string }[];
      }
    >;
  };

  const RENDERER = "test_mutation_measured";

  /** The contexts branch protection requires, read from the declaration. */
  const requiredContexts =
    (
      JSON.parse(
        fs.readFileSync(
          path.join(ROOT, ".github", "required-checks.json"),
          "utf8"
        )
      ) as { readonly required_contexts?: readonly string[] }
    ).required_contexts ?? [];

  it("runs ONLY when the gate reported that mutants existed", () => {
    // The whole fix. A positive condition means an unrecognised or missing
    // outcome leaves the job SKIPPED — which `gh pr checks` prints as
    // `skipping` — rather than green. Inverting this to `!= 'false'` would
    // restore the false green while looking like a tidy-up.
    const job = quality.jobs[RENDERER];

    expect(job).toBeTruthy();
    expect(job?.if).toContain(
      "needs.test_mutation.outputs.mutation_measured == 'true'"
    );
    expect(job?.needs).toEqual(["test_mutation"]);
    // No `always()`: a FAILED gate is already red and says so itself.
    expect(job?.if).not.toContain("always()");
  });

  it("is silenced by the `needs` chain, not by a token of its own", () => {
    // The silencing is REAL and it is structural: every route that stops
    // `test_mutation` leaves `needs.test_mutation.result` something other than
    // `success`, which this job's condition requires. Restating the token here
    // would buy no control and cost one — `SKIP_JOB_TOKENS` is derived from
    // these conditions, so a second job on `test:mutation` flips
    // `gateForSkipJob` from `replaceable` to `partial`, changing what the token
    // advertises to every consumer in order to say something already true.
    expect(quality.jobs[RENDERER]?.if).toContain(
      "needs.test_mutation.result == 'success'"
    );
    expect(quality.jobs[RENDERER]?.if).not.toContain("skip_jobs");
    expect(SKIP_JOB_TOKENS["test:mutation"]).toEqual(["test_mutation"]);
    expect(gateForSkipJob("test:mutation").status).toBe("replaceable");
  });

  it("needs NO permission, which is what makes it possible here at all", () => {
    // #3664 rendered the same class of defect with a `neutral` check run,
    // needing `checks: write`. That is unavailable in this file: `quality.yml`
    // is `workflow_call`-only and a called workflow may only DOWNGRADE its
    // caller's grant — asking for more is a startup_failure for the whole run
    // (#2049). A skipped job costs no permission, so it reaches the same layer
    // for free. If this ever grows a permission block, the design was lost.
    expect(quality.jobs[RENDERER]?.permissions).toEqual({});
  });

  it("carries the gate's outcome out of the measuring job, both routes", () => {
    // Two steps can run the gate — the declared-gate path and the fallback —
    // and exactly one of them does. Reading only one would leave the renderer
    // permanently skipped on projects that take the other route: a control
    // that is always absent proves as little as one that is always green.
    const outputs = quality.jobs.test_mutation?.outputs ?? {};

    expect(outputs.mutation_measured).toContain(
      "steps.gate_run.outputs.mutation_measured"
    );
    expect(outputs.mutation_measured).toContain(
      "steps.gate_run_fallback.outputs.mutation_measured"
    );
    expect(
      (quality.jobs.test_mutation?.steps ?? []).some(
        step => step.id === "gate_run_fallback"
      )
    ).toBe(true);
  });

  it("resolves no gate of its own, and must never be a required context", () => {
    // `QUALITY_JOB_GATES` is DERIVED from which jobs carry a `gate` resolve
    // step; this job reports on a gate rather than resolving one, so a row for
    // it would be a claim the workflow does not make. It also must never be
    // promoted to a required context: being SKIPPED is its normal, correct
    // state on any pull request that touches no mutate target, and branch
    // protection cannot see a skipped context as satisfied — requiring it
    // would block every such pull request forever.
    expect(QUALITY_JOB_GATES[RENDERER]).toBeUndefined();
    expect(requiredContexts).not.toContain(
      `🔍 Quality Checks / ${quality.jobs[RENDERER]?.name ?? ""}`
    );
    // And it must not wear the gate's label, which is the matched context.
    expect(quality.jobs[RENDERER]?.name).not.toBe(
      quality.jobs.test_mutation?.name
    );
  });
});
