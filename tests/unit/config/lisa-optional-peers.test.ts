/**
 * Lisa's optional peers are exactly the packages its own tooling runs from a
 * host's tree, at exactly the range Lisa forces or depends on
 * (CodySwannGT/lisa#4932).
 *
 * A host's dead-code gate counts a dependency as used when a package the host
 * uses names it as a peer. Three packages are consumed by Lisa's shipped
 * tooling rather than the host's code: `eslint-plugin-oxlint`, which Lisa's
 * ESLint configs import from the host's tree; `fast-check`, the
 * property-testing library decision D5 keeps present in every governed
 * TypeScript project; and `standard-version`, which Lisa's release workflow
 * runs with `npx` in the host, so a host's pinned copy wins over the one Lisa
 * brings.
 * Declaring each as an optional peer of `@codyswann/lisa` states that
 * relationship where knip reads it, so a host stays green without an ignore
 * list. Optional, so a host that does not run the tooling is never made to
 * install it; and at the range Lisa forces or itself depends on, so the
 * declaration can never disagree with what a host receives.
 * @module tests/unit/config/lisa-optional-peers
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The peers, and why each is one. A new peer must be argued for here. */
const EXPECTED_PEERS = [
  "eslint-plugin-oxlint",
  "fast-check",
  "standard-version",
] as const;

/** The parts of Lisa's own manifest the peers are checked against. */
interface Manifest {
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

/** The part of a stack template that forces host dependencies. */
interface Template {
  readonly force?: { readonly devDependencies?: Record<string, string> };
}

/**
 * Parse a repository JSON file.
 * @param relative - Path from the repository root
 * @returns Parsed contents
 */
function readJson<T>(relative: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, relative), "utf8")
  ) as T;
}

/**
 * Every range any stack template forces for a package.
 * @param name - Package name
 * @returns `stack: range` lines
 */
function forcedRanges(name: string): readonly string[] {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry => path.join(entry.name, "package-lisa", "package.lisa.json"))
    .filter(file => fs.existsSync(path.join(REPO_ROOT, file)))
    .flatMap(file => {
      const range = readJson<Template>(file).force?.devDependencies?.[name];
      return range === undefined ? [] : [`${file}: ${range}`];
    });
}

const MANIFEST = readJson<Manifest>("package.json");

describe("Lisa's optional peers", () => {
  it("declares exactly the argued-for peers", () => {
    expect(
      Object.keys(MANIFEST.peerDependencies ?? {}).sort((a, b) =>
        a.localeCompare(b)
      )
    ).toEqual([...EXPECTED_PEERS]);
  });

  it.each(EXPECTED_PEERS)("marks %s optional", name => {
    expect(MANIFEST.peerDependenciesMeta?.[name]?.optional).toBe(true);
  });

  it.each(EXPECTED_PEERS)(
    "declares %s at the one range Lisa forces or depends on",
    name => {
      const peer = MANIFEST.peerDependencies?.[name];
      const own = MANIFEST.dependencies?.[name];
      const forced = [
        ...forcedRanges(name),
        ...(own === undefined ? [] : [`package.json: ${own}`]),
      ];
      expect(forced.length).toBeGreaterThan(0);
      expect(forced.filter(line => !line.endsWith(`: ${peer}`))).toEqual([]);
    }
  );
});
