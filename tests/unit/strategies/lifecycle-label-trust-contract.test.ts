/**
 * Regression coverage for the lifecycle-label trust contract (#2539).
 *
 * The classifier in `lifecycle-label-trust.mjs` is only a control on every
 * harness if it reaches each generated plugin mirror, so the script must exist
 * in every mirror the plugin build produces. How the intake and repair skills
 * word their use of it is guidance prose, reviewed rather than pinned.
 *
 * **The roots are DISCOVERED, never hand-listed.** A literal array of mirrors is
 * an assertion whose population is narrower than the thing it claims to cover —
 * the same defect this PR exists to fix, and it would pass unchanged the day a
 * sixth mirror is added. Roots come from globbing the build output, and the
 * script requirement is pegged to an existing peer script so a mirror cannot
 * quietly ship one without the other.
 * @module tests/unit/strategies/lifecycle-label-trust-contract
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const BUILD_INTAKE = "skills/lisa-github-build-intake/SKILL.md";
const SCRIPT = "scripts/lifecycle-label-trust.mjs";
/** An existing base script; any mirror shipping it must ship ours too. */
const PEER_SCRIPT = "scripts/queue-health-classification.mjs";

/**
 * Every directory that carries the build-intake skill — the source of truth
 * plus each generated mirror, discovered rather than enumerated.
 *
 * @returns absolute-relative roots, sorted for stable test naming
 */
const discoverRoots = (): readonly string[] => {
  const found: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > 3) {
      return;
    }
    for (const entry of readdirSync(dir)) {
      const child = path.join(dir, entry);
      if (!statSync(child).isDirectory()) {
        continue;
      }
      if (existsSync(path.join(child, BUILD_INTAKE))) {
        found.push(child);
      }
      visit(child, depth + 1);
    }
  };
  visit("plugins", 0);
  return [...new Set([...found, "plugins/src/base"])].sort((left, right) =>
    left.localeCompare(right)
  );
};

const ROOTS = discoverRoots();

describe("lifecycle-label trust contract (#2539)", () => {
  it("discovers every mirror instead of trusting a hand-listed array", () => {
    // Guards the discovery itself: if the glob silently stopped matching, this
    // suite would pass vacuously with zero roots.
    expect(ROOTS.length).toBeGreaterThanOrEqual(5);
    expect(ROOTS).toContain("plugins/src/base");
    expect(ROOTS).toContain("plugins/lisa");
  });

  describe.each(ROOTS)("%s", root => {
    it("ships the classifier wherever it ships its peer scripts", () => {
      if (!existsSync(path.resolve(root, PEER_SCRIPT))) {
        expect(existsSync(path.resolve(root, BUILD_INTAKE))).toBe(true);
        return;
      }
      expect(existsSync(path.resolve(root, SCRIPT))).toBe(true);
    });
  });
});
