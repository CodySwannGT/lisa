/**
 * Regression coverage for the lifecycle-label trust contract (#2539).
 *
 * The classifier in `lifecycle-label-trust.mjs` is only a control if the intake
 * and repair skills actually consult it, and only a control on every harness if
 * it reaches each generated plugin mirror. These tests bind both: the skill
 * prose must cite the classifier and the distrust-never-revert rule, and the
 * script must exist in every mirror the plugin build produces.
 *
 * **The roots are DISCOVERED, never hand-listed.** A literal array of mirrors is
 * an assertion whose population is narrower than the thing it claims to cover —
 * the same defect this PR exists to fix, and it would pass unchanged the day a
 * sixth mirror is added. Roots come from globbing the build output, and the
 * script requirement is pegged to an existing peer script so a mirror cannot
 * quietly ship one without the other.
 *
 * Assertions run against whitespace-flattened text so markdown line wrapping
 * cannot break them, and so no assertion needs a backtracking-prone regex.
 * @module tests/unit/strategies/lifecycle-label-trust-contract
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { flatten } from "./support/lifecycle-label-trust.js";

const BUILD_INTAKE = "skills/lisa-github-build-intake/SKILL.md";
const REPAIR_INTAKE = "skills/lisa-repair-intake/SKILL.md";
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

const read = (root: string, relative: string): string =>
  flatten(readFileSync(path.resolve(root, relative), "utf8"));

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

    it("makes build-intake resolve label trust before believing a label", () => {
      const skill = read(root, BUILD_INTAKE);
      expect(skill).toContain(SCRIPT);
    });

    it("refuses to claim on a bot-applied ready label", () => {
      const skill = read(root, BUILD_INTAKE);

      expect(skill).toContain("`$READY` is **untrusted** is **not claimable**");
      expect(skill).toContain("`$CLAIMED` is **untrusted** is **not claimed**");
    });

    it("walks both lifecycle drift directions in one repair pass", () => {
      const repair = read(root, REPAIR_INTAKE);
      const section = repair.slice(
        repair.indexOf("Lifecycle label contradicts native state"),
        repair.indexOf("Bot-authored lifecycle label")
      );

      expect(section).toContain("terminal-label-open-state");
      expect(section).toContain("open-label-closed-state");
    });

    it("forbids advancing a not-planned closure to the terminal role", () => {
      // The skill must preserve the classifier's retire-only outcome.
      const repair = read(root, REPAIR_INTAKE);
      const section = repair.slice(
        repair.indexOf("Lifecycle label contradicts native state"),
        repair.indexOf("Bot-authored lifecycle label")
      );

      expect(section).toContain("open-label-abandoned-state");
    });

    it("builds trust input per invocation, never from cross-skill temp state", () => {
      for (const relative of [BUILD_INTAKE, REPAIR_INTAKE]) {
        const skill = read(root, relative);
        expect(skill).toContain(`trap 'rm -rf "$TRUST_DIR"' EXIT`);
        // No fixed shared path any concurrent run could collide on. Assembled
        // from parts so this guard does not itself hardcode a world-writable
        // path literal (sonarjs/publicly-writable-directories).
        expect(skill).not.toContain(
          ["", "tmp", "lisa-trust-input.json"].join("/")
        );
      }
    });

    it("flattens the paginated timeline instead of reading page one", () => {
      for (const relative of [BUILD_INTAKE, REPAIR_INTAKE]) {
        expect(read(root, relative)).toContain("--paginate --slurp");
      }
    });

    it("resolves config through the local override and tolerates absence", () => {
      for (const relative of [BUILD_INTAKE, REPAIR_INTAKE]) {
        const skill = read(root, relative);

        expect(skill).toContain(".lisa.config.local.json");
        expect(skill).toContain("2>/dev/null || echo '{}'");
      }
    });
  });
});
