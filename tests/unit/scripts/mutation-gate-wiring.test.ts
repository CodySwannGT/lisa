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
    expect(manifest.scripts["test:mutation"]).toBe("stryker run");
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
});
