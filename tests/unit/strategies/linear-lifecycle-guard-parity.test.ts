/**
 * Agent-surface parity for the Linear state-write guard (#3356).
 *
 * The guard ships as plugin bytes. A fix present only in `plugins/src/base`
 * leaves consumers on the broken version, so each generated variant is checked
 * for a byte-identical copy of the script, shipped wherever the lifecycle
 * resolver it calls ships. The skill prose that tells callers to declare a
 * role is guidance and is reviewed, not pinned (#4867).
 * @module tests/unit/strategies/linear-lifecycle-guard-parity
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Repository root; every path below is resolved from it. */
const ROOT = process.cwd();

/** The guard's path inside any plugin root, and its authored source. */
const GUARD_IN_PLUGIN = "scripts/linear-state-write-target.mjs";
const GUARD_SOURCE = `plugins/src/base/${GUARD_IN_PLUGIN}`;

/**
 * Every generated agent surface that carries the base plugin's scripts.
 *
 * The same roster the pre-existing lifecycle resolver ships to — a guard that
 * reached fewer surfaces than the resolver it calls would be inert exactly
 * where the resolver still runs.
 */
const AGENT_SURFACES = [
  "plugins/lisa",
  "plugins/lisa-cursor",
  "plugins/lisa-agy",
  "plugins/lisa-copilot",
];

/**
 * Read a repository-relative file.
 *
 * @param {string} path repository-relative path
 * @returns {string} file contents
 */
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

describe("every supported agent surface carries the same guard", () => {
  const source = read(GUARD_SOURCE);

  it.each(AGENT_SURFACES)("%s ships a byte-identical validator", surface => {
    const path = join(surface, GUARD_IN_PLUGIN);

    expect(existsSync(join(ROOT, path))).toBe(true);
    expect(read(path)).toBe(source);
  });

  it("ships the guard everywhere the resolver it calls ships", () => {
    for (const surface of AGENT_SURFACES)
      expect(
        existsSync(join(ROOT, surface, "scripts/resolve-lifecycle-role.mjs"))
      ).toBe(true);
  });
});
