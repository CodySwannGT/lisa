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
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { compareFile } from "../../../plugins/src/base/hooks/threshold-ratchet-compare.mjs";
import { familyFor } from "../../../plugins/src/base/hooks/threshold-ratchet-families.mjs";
import {
  mutatedGuards,
  scopedGuards,
  suitesByGuard,
  suitesReachingGuards,
} from "../../../vitest.config.mutation";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const CONF_REL = "stryker.conf.json";

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
    expect(manifest.scripts["test:mutation"]).toBe(
      "node scripts/lisa-mutation.mjs"
    );
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
      "node scripts/lisa-mutation.mjs --all"
    );
    expect(manifest.scripts["test:mutation:full"]).toContain(
      "scripts/lisa-mutation.mjs"
    );
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
