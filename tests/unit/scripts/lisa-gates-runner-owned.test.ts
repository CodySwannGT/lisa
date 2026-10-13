/**
 * The registry half of moving five pull-request gates onto declared gate legs
 * (CodySwannGT/lisa#3052), pinned where the mutation gate can see it.
 *
 * `tests/integration/quality-runner-owned-gates.test.ts` pins the workflow
 * shape. This suite pins the data the registry now carries for those gates,
 * because only unit suites join the mutation run, and each value here is one a
 * consumer reads:
 *
 * - `seedGates` must still declare each gate at pull-request, with the same
 *   task it chose while the quality-workflow inventory drove it. A seed that
 *   stops declaring a gate leaves a newly seeded project with no leg and no
 *   check, and nothing reports the absence.
 * - each retired `skip_jobs` token must say what replaced it and how to turn
 *   the check off, because the token now suppresses nothing.
 * - the pre-push inventory rows for three of the same gates are unchanged.
 * @module tests/unit/scripts/lisa-gates-runner-owned
 */
import { describe, expect, it } from "vitest";

import {
  HARDCODED_INVOCATIONS,
  RETIRED_SKIP_JOB_TOKENS,
  seedGates,
  skipJobMigration,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const PULL_REQUEST = "pull-request";
const CODE_STYLE_SLOW = "code-style-slow";
const TYPE_CORRECTNESS = "type-correctness";
const FORMAT_CONFORMANCE = "format-conformance";
const BUILD_INTEGRITY = "build-integrity";
const DEAD_CODE = "dead-code";
const KNIP_CHECK = "knip:check";

/** Every script the five seeds can choose between. */
const ALL_SCRIPTS = Object.freeze({
  "lint:slow": "eslint .",
  typecheck: "tsc --noEmit",
  "format:check": "prettier --check .",
  build: "tsc",
  "knip:check": "knip",
  knip: "knip",
});

/** One seeded declaration, as `seedGates` reports it. */
interface Seeded {
  gate: string;
  moment: string;
  run: string | null;
}

/**
 * The pull-request seeds for one project's scripts.
 * @param scripts - The project's package.json scripts
 * @returns Seeded pull-request declarations, keyed by gate
 */
const pullRequestSeeds = (
  scripts: Record<string, string>
): Map<string, Seeded> =>
  new Map(
    (seedGates({ gates: {}, scripts }).seeded as Seeded[])
      .filter(entry => entry.moment === PULL_REQUEST)
      .map(entry => [entry.gate, entry])
  );

describe("seeding the gates a declared leg now proves", () => {
  it.each([
    [CODE_STYLE_SLOW, null],
    [TYPE_CORRECTNESS, null],
    [FORMAT_CONFORMANCE, null],
    [BUILD_INTEGRITY, null],
    // The registry default for dead-code is `check:dead-code`, which the
    // stacks do not ship, so the seed names the shipped task explicitly.
    [DEAD_CODE, KNIP_CHECK],
  ])("declares %s at pull-request with run %s", (gate, run) => {
    expect(pullRequestSeeds(ALL_SCRIPTS).get(gate)).toEqual({
      gate,
      moment: PULL_REQUEST,
      run,
    });
  });

  it("writes the dead-code declaration with its run, at the required level", () => {
    const { gates } = seedGates({ gates: {}, scripts: ALL_SCRIPTS });
    expect(
      (gates as Record<string, Record<string, unknown>>)[DEAD_CODE]?.[
        PULL_REQUEST
      ]
    ).toEqual({ level: "required", run: KNIP_CHECK });
    expect(
      (gates as Record<string, Record<string, unknown>>)[TYPE_CORRECTNESS]?.[
        PULL_REQUEST
      ]
    ).toBe("required");
  });

  it("falls back to the unnamespaced knip task when knip:check is absent", () => {
    const scripts: Record<string, string> = { knip: "knip" };
    expect(pullRequestSeeds(scripts).get(DEAD_CODE)?.run).toBe("knip");
  });

  it("declares nothing for a gate whose task the project does not ship", () => {
    const seeds = pullRequestSeeds({});
    for (const gate of [
      CODE_STYLE_SLOW,
      TYPE_CORRECTNESS,
      FORMAT_CONFORMANCE,
      BUILD_INTEGRITY,
      DEAD_CODE,
    ]) {
      expect(seeds.has(gate), gate).toBe(false);
    }
  });

  it("never overwrites a declaration the project already made", () => {
    const { gates } = seedGates({
      gates: { [TYPE_CORRECTNESS]: { [PULL_REQUEST]: "off" } },
      scripts: ALL_SCRIPTS,
    });
    expect(
      (gates as Record<string, Record<string, unknown>>)[TYPE_CORRECTNESS]?.[
        PULL_REQUEST
      ]
    ).toBe("off");
  });
});

describe("retiring the tokens of the deleted jobs", () => {
  it.each([
    ["lint_slow", CODE_STYLE_SLOW],
    ["typecheck", TYPE_CORRECTNESS],
    ["format", FORMAT_CONFORMANCE],
    ["build", BUILD_INTEGRITY],
    ["dead_code", DEAD_CODE],
  ])(
    "explains %s and names the %s declaration that replaces it",
    (token, gate) => {
      const entry = (
        RETIRED_SKIP_JOB_TOKENS as Record<
          string,
          { retiredIn: string; reason: string }
        >
      )[token];
      expect(entry?.retiredIn).toBe("#3052");
      expect(entry?.reason).toContain(`for the ${gate} gate`);
      expect(entry?.reason).toContain(`gates.${gate}["pull-request"] as "off"`);
      expect(entry?.reason).toContain("this token suppresses nothing");
    }
  );
});

describe("the pre-push rows for the same gates", () => {
  it.each([
    [TYPE_CORRECTNESS, "<runner> typecheck", null],
    [CODE_STYLE_SLOW, "<runner> lint:slow", null],
    [DEAD_CODE, "<runner> knip:check", [KNIP_CHECK, "knip"]],
  ])("keeps %s at push running %s", (gate, command, seedRun) => {
    const row = (
      HARDCODED_INVOCATIONS as readonly {
        gate: string;
        moment: string;
        command: string;
        seedRun: readonly string[] | null;
      }[]
    ).find(entry => entry.gate === gate && entry.moment === "push");
    expect(row?.command).toBe(command);
    expect(row?.seedRun).toEqual(seedRun);
  });
});

describe("migrating a retired token", () => {
  it.each([
    ["lint_slow", CODE_STYLE_SLOW],
    ["typecheck", TYPE_CORRECTNESS],
    ["format", FORMAT_CONFORMANCE],
    ["build", BUILD_INTEGRITY],
    ["dead_code", DEAD_CODE],
  ])("offers the off declaration that keeps %s's check off", (token, gate) => {
    expect(skipJobMigration(token, PULL_REQUEST)).toMatchObject({
      status: "retired",
      gate: null,
      declaration: `"${gate}": { "${PULL_REQUEST}": "off" }`,
    });
  });

  it("offers nothing for a retired token whose job proved no gate", () => {
    expect(
      skipJobMigration("zap_baseline", PULL_REQUEST).declaration
    ).toBeNull();
  });

  it("offers nothing at a moment the gate cannot be declared at", () => {
    expect(skipJobMigration("build", "commit").declaration).toBeNull();
    expect(skipJobMigration("build", "not-a-moment").declaration).toBeNull();
  });
});
