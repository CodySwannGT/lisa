/**
 * No fixture in this tree names a staged script's dependencies.
 *
 * CodySwannGT/lisa#3082. Five fixtures listed, by name, the sibling modules the
 * shipped script they stage imports. Each was correct when written; each
 * silently stopped being correct the moment that script acquired a second
 * sibling, which happened once — CodySwannGT/lisa#2980 — and broke all five at
 * the same time. Nothing failed in between, because a frozen roster reports
 * clean for the entire period it is wrong.
 *
 * The fix was one line each and is not what this suite is for. **The habit is
 * what produces them**, and a sixth was written in the hour after the issue was
 * filed. This scan is the thing that makes the habit visible on the way in.
 *
 * ## No allowlist
 *
 * Every arm below scans the whole tracked test tree and must come back empty.
 * There is no exemption map here on purpose: an allowlist added to harden a
 * guard has already become the way around one in this repository. Six live
 * instances were found by this scan on the day it was written and all six were
 * repaired rather than grandfathered.
 * @module tests/unit/helpers/staged-dependency-conformance
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  moduleGraph,
  stagedScriptCopies,
  type ModuleGraph,
} from "../../helpers/staged-dependency-scan.js";
import { checkoutFiles } from "../../helpers/tracked-files.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Stand-in path the detector's control cases are reported against. */
const SAMPLE = "tests/sample.test.ts";

/** The staged entry point of the control lane. */
const ENTRY = "lane/scripts/entry.mjs";

/** Its flat neighbour, which it imports. */
const PEER = "lane/scripts/peer.mjs";

/** The module it reaches into a subdirectory for. */
const SHARED = "lane/scripts/lib/shared.mjs";

/** The line every control fixture wraps its staging in. */
const STAGE_SIGNATURE = "export function stage(project: string): void {";

/** How the control fixtures spell a staged copy's destination. */
const STAGE_ENTRY =
  'copyFileSync(path.join(SRC, "entry.mjs"), path.join(project, "entry.mjs"));';

/**
 * A three-module shipped lane, small enough to reason about completely.
 *
 * A hand-built graph rather than the repository's own, so the control cases
 * below state what they are testing instead of depending on which sibling
 * `lisa-gates.mjs` happens to import this week.
 *
 * `entry.mjs` and `peer.mjs` sit flat beside each other and one imports the
 * other; `lib/shared.mjs` sits in a directory `entry.mjs` reaches INTO. That is
 * the whole distinction the scan turns on, in three files.
 */
const LANE: ReadonlyMap<string, string> = new Map([
  [
    ENTRY,
    [
      'import { peer } from "./peer.mjs";',
      'import { shared } from "./lib/shared.mjs";',
      "export const run = () => peer(shared);",
    ].join("\n"),
  ],
  [PEER, "export const peer = value => value;"],
  [SHARED, "export const shared = 1;"],
]);

/** The graph the control cases are read against. */
const LANE_GRAPH: ModuleGraph = moduleGraph(LANE);

/**
 * The repaired fixture, reintroduced verbatim in shape.
 *
 * This is `lisa-github-rulesets.test.ts` and its four siblings as they stood
 * before CodySwannGT/lisa#3076: a module-level const holding the dependency's
 * path, copied beside the script that imports it.
 */
const VENDORED_BY_NAME = [
  'const SCRIPT = path.join(REPO_ROOT, "lane", "scripts", "entry.mjs");',
  'const HELPER = path.join(REPO_ROOT, "lane", "scripts", "lib", "shared.mjs");',
  "",
  STAGE_SIGNATURE,
  '  copyFileSync(SCRIPT, path.join(project, "scripts", "entry.mjs"));',
  '  copyFileSync(HELPER, path.join(project, "scripts", "lib", "shared.mjs"));',
  "}",
].join("\n");

/** The same fixture reading the bucket, which is the fix that was applied. */
const READS_THE_DIRECTORY = [
  'const SCRIPT = path.join(REPO_ROOT, "lane", "scripts", "entry.mjs");',
  'const LIB = path.join(REPO_ROOT, "lane", "scripts", "lib");',
  "",
  STAGE_SIGNATURE,
  '  copyFileSync(SCRIPT, path.join(project, "scripts", "entry.mjs"));',
  "  for (const name of readdirSync(LIB)) {",
  '    copyFileSync(path.join(LIB, name), path.join(project, "scripts", "lib", name));',
  "  }",
  "}",
].join("\n");

/**
 * Every tracked TypeScript file under `tests/`.
 *
 * `checkoutFiles` rather than a walk or a hardcoded roster: the index is
 * exactly what a commit can carry, and it still answers inside Stryker's
 * sandbox copy, which has no `.git` of its own and would otherwise make this
 * roster empty — a green scan over nothing.
 * @returns Repository-relative paths of the tracked test-tree sources
 */
function trackedTestSources(): readonly string[] {
  return checkoutFiles(REPO_ROOT).filter(
    name => name.startsWith("tests/") && name.endsWith(".ts")
  );
}

/**
 * The repository's own import graph, derived from every tracked module.
 *
 * Built from the shipped scripts' import statements on every run. **This scan
 * carries no roster of modules a fixture must not name**, because a roster
 * would be the defect it exists to refuse, one level up.
 * @returns Each tracked `.mjs` mapped to the modules it imports
 */
function repositoryGraph(): ModuleGraph {
  return moduleGraph(
    new Map(
      checkoutFiles(REPO_ROOT)
        .filter(name => name.endsWith(".mjs"))
        .map(name => [name, readFileSync(path.join(REPO_ROOT, name), "utf8")])
    )
  );
}

/**
 * Scan the tracked test tree once.
 * @returns Every offender, and how many fixtures actually staged something
 */
function scanTestTree(): {
  readonly offenders: readonly string[];
  readonly fixtures: number;
} {
  const graph = repositoryGraph();
  const reports = trackedTestSources().map(name =>
    stagedScriptCopies(
      name,
      readFileSync(path.join(REPO_ROOT, name), "utf8"),
      graph
    )
  );
  return {
    offenders: reports.flatMap(report => report.offenders),
    fixtures: reports.filter(report => report.staged.length > 0).length,
  };
}

describe("no fixture stages a shipped script's dependencies by name", () => {
  it("flags a fixture naming the module its staged script imports", () => {
    // The positive control, and the reason this suite can be believed. Without
    // it a clean tree and a broken detector are indistinguishable, and the tree
    // arm below would be permanently green for the wrong reason.
    expect(stagedScriptCopies(SAMPLE, VENDORED_BY_NAME, LANE_GRAPH)).toEqual({
      staged: [ENTRY, SHARED],
      offenders: [`${SAMPLE}:6: ${SHARED}`],
    });
  });

  it("passes the same fixture once it reads the directory", () => {
    // The safe form has to be the one that clears the scan, or nobody adopts
    // it. The basename is a loop variable here, so there is no roster to fall
    // behind — which is the entire point of the fix.
    expect(
      stagedScriptCopies(SAMPLE, READS_THE_DIRECTORY, LANE_GRAPH).offenders
    ).toEqual([]);
    expect(
      stagedScriptCopies(SAMPLE, READS_THE_DIRECTORY, LANE_GRAPH).staged
    ).toEqual([ENTRY]);
  });

  it("leaves a fixture naming two flat entry points alone", () => {
    // The NEGATIVE control that decides whether this rule survives contact.
    // `deploy-gate-blocks-release.test.ts` copies two shipped scripts by name —
    // one of which imports the other — and copies their `lib/` as a directory.
    // A rule that flagged that would be flagging the safe form, and would be
    // switched off within a month. A flat `./peer.mjs` import is a peer the
    // fixture chose; it is not a bucket whose membership drifts.
    const flat = [
      STAGE_ENTRY,
      'copyFileSync(path.join(SRC, "peer.mjs"), path.join(project, "peer.mjs"));',
    ].join("\n");

    expect(stagedScriptCopies(SAMPLE, flat, LANE_GRAPH)).toEqual({
      staged: [ENTRY, PEER],
      offenders: [],
    });
  });

  it("leaves a fixture that names a module without copying it alone", () => {
    // `plugin-sync-scripts.test.ts` writes `invoked-as-script.mjs` several
    // times to build the paths its assertions expect a build to produce, and
    // never stages it. The scan is anchored on the copy call rather than on the
    // string, because a rule that flagged every fixture mentioning a filename
    // would be noise.
    const mentions = [
      'const EXPECTED = path.join("lane", "scripts", "lib", "shared.mjs");',
      "expect(existsSync(path.join(built, EXPECTED))).toBe(true);",
    ].join("\n");

    expect(stagedScriptCopies(SAMPLE, mentions, LANE_GRAPH)).toEqual({
      staged: [],
      offenders: [],
    });
  });

  it("reads an array of names consumed by a loop", () => {
    // The canonical spelling of this defect, and the one a single-answer fold
    // would be blind to: the roster is not at the copy call, it is an array
    // declared elsewhere and iterated. This is
    // `maestro-native-flake-classification.test.ts` exactly.
    const looped = [
      'const DEPENDENCIES = [path.join("lib", "shared.mjs")];',
      "",
      STAGE_SIGNATURE,
      '  copySync(path.join(SRC, "entry.mjs"), path.join(project, "entry.mjs"));',
      "  for (const dependency of DEPENDENCIES) {",
      "    copySync(path.join(SRC, dependency), path.join(project, dependency));",
      "  }",
      "}",
    ].join("\n");

    expect(stagedScriptCopies(SAMPLE, looped, LANE_GRAPH).offenders).toEqual([
      `${SAMPLE}:6: ${SHARED}`,
    ]);
  });

  it("derives the dependency set instead of carrying one", () => {
    // The scan must stay correct when a shipped script grows an import, with no
    // list inside it needing an edit. Same fixture text, same detector; only
    // the lane changed, and the answer moved with it.
    const grown = moduleGraph(
      new Map([
        ...LANE,
        [
          ENTRY,
          [
            'import { peer } from "./peer.mjs";',
            'import { shared } from "./lib/shared.mjs";',
            'import { extra } from "./lib/extra.mjs";',
            "export const run = () => peer(shared, extra);",
          ].join("\n"),
        ],
        ["lane/scripts/lib/extra.mjs", "export const extra = 2;"],
      ])
    );
    const namesTheNewSibling = [
      STAGE_ENTRY,
      'copyFileSync(path.join(SRC, "lib", "extra.mjs"), path.join(project, "lib", "extra.mjs"));',
    ].join("\n");

    expect(
      stagedScriptCopies(SAMPLE, namesTheNewSibling, LANE_GRAPH).offenders
    ).toEqual([]);
    expect(
      stagedScriptCopies(SAMPLE, namesTheNewSibling, grown).offenders
    ).toEqual([`${SAMPLE}:2: lane/scripts/lib/extra.mjs`]);
  });

  it("finds none in the tracked test tree", () => {
    expect(
      scanTestTree().offenders,
      "A fixture that names the modules its staged script imports is a second, " +
        "silent copy of that script's dependency set, and it reports clean for " +
        "the whole period it is wrong. Copy the directory the script imports " +
        "into — `readdirSync` it, or copy it whole — instead of listing its " +
        "members. There is no exemption list."
    ).toEqual([]);
  });

  it("scans fixtures that are actually there", () => {
    // The arm above cannot pass by inspecting nothing. A fold that quietly
    // stopped resolving — a rename, a new path idiom, a `checkoutFiles` that
    // came back empty in a sandbox — would turn it into a check on the empty
    // set, which is the exact façade this whole effort exists to remove.
    const { fixtures } = scanTestTree();
    expect(
      fixtures,
      `Resolved ${fixtures} fixtures staging a shipped module; an empty scan ` +
        "and a clean tree are otherwise indistinguishable."
    ).toBeGreaterThan(10);
    expect(trackedTestSources().length).toBeGreaterThan(100);
  });
});
