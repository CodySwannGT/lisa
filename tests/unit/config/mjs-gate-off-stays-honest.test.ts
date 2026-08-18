/**
 * Keeps `test-node-suites: off` honest about why it is off.
 *
 * This repository declares the gate `off` because it genuinely has no
 * `*.test.mjs` suites — the plugin suites are collected by vitest, and the
 * `.mjs` runner it ships resolves for CONSUMERS through their installed
 * package, never for the repository that ships it. `off` was the remedy the
 * gate's own error message prescribed, and it is the honest one: it drops the
 * required context instead of satisfying it vacuously.
 *
 * What `off` cannot do is stay correct on its own. The first `*.test.mjs`
 * added here would go unrun with the gate reporting nothing at all — not a
 * red, not a warning, silence. That is the same shape as every defect this
 * gate exists to catch, arriving through the remedy rather than the bug.
 *
 * So the declaration and the fact it rests on are checked against each other.
 * Adding a `.mjs` suite while the gate is `off` fails here and names the
 * contradiction; the fix is to stop declaring `off`, not to edit this test.
 * @module tests/unit/config/mjs-gate-off-stays-honest
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** The gate whose declaration this guard holds to its stated reason. */
const GATE_ID = "test-node-suites";

/**
 * Directories that are not this repository's own source.
 *
 * `node_modules` matters most: the self-referencing devDependency installs an
 * older Lisa under it, and counting a suite shipped by that copy as evidence
 * about THIS repository is exactly the confusion #2695 was filed about.
 */
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".next",
  "build",
]);

/**
 * Walks the repository for `*.test.mjs`, independent of any glob.
 *
 * Deliberately a plain recursive `readdir` rather than the pattern the runner
 * uses: a guard that derived both sides from the same glob would agree with
 * itself however wrong the glob became.
 * @param directory - Absolute directory to walk
 * @returns Repository-relative paths of every `*.test.mjs` found
 */
function findMjsSuites(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) {
      return SKIP_DIRECTORIES.has(entry.name)
        ? []
        : findMjsSuites(path.join(directory, entry.name));
    }
    return entry.name.endsWith(".test.mjs")
      ? [path.relative(REPO_ROOT, path.join(directory, entry.name))]
      : [];
  });
}

/**
 * Reads this repository's declared level for the gate.
 * @returns The declared level, or `undefined` when the gate is not declared
 */
function declaredLevel(): unknown {
  const raw = readFileSync(path.join(REPO_ROOT, ".lisa.config.json"), "utf-8");
  const config = JSON.parse(raw) as {
    readonly gates?: Record<string, unknown>;
  };
  return (config.gates ?? {})[GATE_ID];
}

describe("test-node-suites off stays honest", () => {
  it("declares the gate off only while no .mjs suite exists to run", () => {
    const level = declaredLevel();
    if (level !== "off") {
      // Declared required/optional, or not declared at all — the runner
      // governs from here and there is nothing for this guard to contradict.
      return;
    }

    const suites = findMjsSuites(REPO_ROOT);

    expect(
      suites,
      `gates.${GATE_ID} is declared "off" on the premise that this repository ` +
        `has no *.test.mjs suites, but ${suites.length} now exist:\n` +
        `${suites.map(suite => `  ${suite}`).join("\n")}\n` +
        `Those suites are NOT being run and the gate reports nothing at all. ` +
        `Remove the "off" declaration so the runner collects them — do not ` +
        `edit this test, which exists to make that omission impossible.`
    ).toEqual([]);
  });

  it("fails if the gate declaration disappears from the config entirely", () => {
    // An absent declaration is what reddened every pull request in #2695: the
    // job runs, finds no runner, and refuses to pass. Pinning presence means a
    // stray edit that drops the key gets caught here rather than in CI.
    expect(declaredLevel()).toBeDefined();
  });
});

describe("this repository can resolve its own gate declarations", () => {
  /**
   * The candidate list READ OUT OF quality.yml, never a copy of it.
   *
   * A hardcoded duplicate would keep passing after someone shortened the real
   * list — the test would be agreeing with itself about a workflow it no
   * longer describes. Parsing the workflow means removing a path there fails
   * here.
   */
  const RESOLVER_CANDIDATES: readonly string[] = (() => {
    const workflow = readFileSync(
      path.join(REPO_ROOT, ".github/workflows/quality.yml"),
      "utf-8"
    );
    const line = workflow
      .split("\n")
      .find(
        candidate =>
          candidate.includes("for candidate in") &&
          candidate.includes("lisa-gates.mjs")
      );
    if (line === undefined) {
      throw new Error(
        "No gate-resolver candidate loop found in quality.yml — the facades " +
          "were restructured and this guard no longer describes them."
      );
    }
    return [...line.matchAll(/"([^"]*lisa-gates\.mjs)"/g)].map(
      match => match[1] as string
    );
  })();

  it("finds a gate resolver on at least one candidate path", () => {
    // Why this exists: for a long time NEITHER of the first two resolved here.
    // `node_modules/@codyswann/lisa` is this repository's own devDependency,
    // pinned `^2.328.0` while latest is 3.x — a caret cannot cross the major,
    // so it installs a version predating lisa-gates.mjs. And Lisa's copy lives
    // under all/copy-overwrite/, not scripts/. With no resolver the facades
    // emit `configured=false` and fall through to built-in behaviour, so EVERY
    // gate this repository declared was inert while reading as configured.
    const found = RESOLVER_CANDIDATES.filter(candidate =>
      existsSync(path.join(REPO_ROOT, candidate))
    );

    expect(
      found,
      `No gate resolver is reachable from any path quality.yml searches:\n` +
        `${RESOLVER_CANDIDATES.map(c => `  ${c}`).join("\n")}\n` +
        `Every gates block in .lisa.config.json is therefore INERT here — the ` +
        `facades resolve configured=false and run built-in behaviour, ` +
        `including for gates declared "off".`
    ).not.toEqual([]);
  });

  it("honours an off declaration through the shipped resolver", () => {
    // The end-to-end check: not "the file exists" but "declaring off actually
    // reads back as off". A resolver that is present but cannot parse this
    // repository's config would still leave the gate inert.
    const resolver = RESOLVER_CANDIDATES.map(c => path.join(REPO_ROOT, c)).find(
      candidate => existsSync(candidate)
    );
    expect(resolver, "no resolver to exercise").toBeDefined();

    const raw = execFileSync(
      process.execPath,
      [
        resolver as string,
        "list",
        "--moment=pull-request",
        "--json",
        "--include-off",
      ],
      { cwd: REPO_ROOT, encoding: "utf-8" }
    );
    const gates = JSON.parse(raw) as readonly { id: string; level: string }[];
    const gate = gates.find(entry => entry.id === GATE_ID);

    expect(
      gate?.level,
      `${GATE_ID} is declared "off" in .lisa.config.json but the resolver ` +
        `reports ${JSON.stringify(gate?.level)}. The declaration is not ` +
        `reaching the facades, so the job will run built-in behaviour anyway.`
    ).toBe("off");
  });
});
