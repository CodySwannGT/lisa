/**
 * Every child the BDD fixtures spawn is bounded, and the bound names itself.
 *
 * CodySwannGT/lisa#2906. `check-bdd-coverage.mjs`, spawned by these fixtures,
 * was watched twice in one session sitting at 0% CPU in state `U` for 15:04 and
 * 10:43, parked inside `SourceTextModule::InnerModuleEvaluation` — before any of
 * its own code ran. While it sat, the per-case budget on the case that spawned
 * it could not fire AT ALL: `spawnSync` blocks the worker's event loop, and
 * vitest's `testTimeout` is a timer on that loop. A budget that cannot fire is
 * not a smaller budget, it is no budget, and the case was reported as having
 * taken however long the child took.
 *
 * So this suite is the standing guard, not the fix's receipt. The fix is that
 * the fixtures spawn through {@link boundedSpawnSync}, which cannot be called
 * without both a scaled `timeout:` and the completion assertion. The guard is
 * that nothing in the fixture directory calls `spawnSync` any other way — and
 * the guard is itself proved against a planted sample, because a scan that
 * finds nothing looks identical whether it is working or inert.
 * @module tests/unit/scripts/bdd-fixture-spawn-budget
 */
import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { makeProject, runGate } from "./bdd/support";

const FIXTURE_DIR = path.resolve(__dirname, "bdd");

/** The one sanctioned way to start a child from these fixtures. */
const SANCTIONED = "boundedSpawnSync";

/**
 * The raw spawn spellings a fixture helper must not use.
 *
 * `spawnSync` is the one that caused CodySwannGT/lisa#2906; the synchronous
 * `exec` pair is the same defect wearing a different name, and banning it now
 * costs nothing because nothing here uses it.
 */
const RAW_SPAWNS = ["spawnSync", "execSync", "execFileSync"] as const;

/**
 * Find every raw child-process start in one fixture helper's source.
 *
 * Line-oriented and syntactic, matching the resolution the defect is legible
 * at: a call that starts a process without going through the bounded wrapper.
 * An import line is not a call, and the wrapper's own name is allowed.
 * @param name - Repository-relative path, for the diagnostic
 * @param source - The helper's source text
 * @returns One `path:line: text` entry per unbounded spawn
 */
function unboundedSpawns(name: string, source: string): readonly string[] {
  return source
    .split("\n")
    .map((line, index) => ({ at: index + 1, text: line.trim() }))
    .filter(
      ({ text }) =>
        !text.startsWith("*") &&
        !text.startsWith("//") &&
        !text.startsWith("import") &&
        !text.includes(SANCTIONED) &&
        RAW_SPAWNS.some(spawn => text.includes(`${spawn}(`))
    )
    .map(({ at, text }) => `${name}:${at}: ${text}`);
}

/**
 * The fixture helper sources this guard governs.
 * @returns Repository-relative names paired with their source text
 */
function fixtureHelpers(): readonly (readonly [string, string])[] {
  return readdirSync(FIXTURE_DIR)
    .filter(name => name.endsWith(".ts"))
    .map(
      name =>
        [
          `tests/unit/scripts/bdd/${name}`,
          readFileSync(path.join(FIXTURE_DIR, name), "utf8"),
        ] as const
    );
}

describe("the bdd fixture helpers start no unbounded child", () => {
  it("reports a raw spawn in a planted sample", () => {
    const planted = [
      "export function runGate(root) {",
      "  const result = spawnSync(process.execPath, [SCRIPT_ABS], {",
      '    encoding: "utf-8",',
      "  });",
      "}",
    ].join("\n");

    expect(unboundedSpawns("support.ts", planted)).toEqual([
      "support.ts:2: const result = spawnSync(process.execPath, [SCRIPT_ABS], {",
    ]);
  });

  it("leaves the bounded spelling and its import alone", () => {
    const bounded = [
      'import { boundedSpawnSync } from "../../../helpers/io-latency-budget.js";',
      "const result = boundedSpawnSync({",
      '  label: "check-bdd-coverage --json",',
      "  command: process.execPath,",
      "});",
    ].join("\n");

    expect(unboundedSpawns("support.ts", bounded)).toEqual([]);
  });

  it("finds none in the fixture directory", () => {
    const offenders = fixtureHelpers().flatMap(([name, source]) =>
      unboundedSpawns(name, source)
    );

    expect(
      offenders,
      "A fixture `spawnSync` with no `timeout:` blocks the worker's event " +
        "loop, so the per-case budget cannot fire for the very case it was " +
        "written for. Start the child with boundedSpawnSync({ label, ... }) " +
        "so the budget scales with the machine and a kill names itself."
    ).toEqual([]);
  });
});

describe("a bounded fixture child still does its job", () => {
  it("runs the real gate to a verdict through the bounded path", () => {
    // The guard above is syntactic; this is the behavioural half. If the
    // wrapper mangled the environment or the encoding, the gate would come
    // back with no envelope at all.
    const run = runGate(makeProject({ map: { schemaVersion: 2 } }));

    expect(run.envelope.status).toBeDefined();
  });

  it("kills a planted hang instead of blocking until the suite dies", () => {
    // The exact failure CodySwannGT/lisa#2906 describes, staged: a child that
    // never returns on its own. The bound is what makes the case finish, and
    // the message is what makes it diagnosable.
    expect(() =>
      boundedSpawnSync({
        label: "a planted bdd fixture child",
        command: process.execPath,
        args: [
          "-e",
          "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000)",
        ],
        baseMs: 1,
      })
    ).toThrow(/a planted bdd fixture child did not complete/u);
  });
});
