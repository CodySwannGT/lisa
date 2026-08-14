/**
 * Regression coverage for the lifecycle-label trust contract (#2539).
 *
 * The classifier in `lifecycle-label-trust.mjs` is only a control if the intake
 * and repair skills actually consult it, and only a control on every harness if
 * it reaches each generated plugin mirror. These tests bind both: the skill
 * prose must cite the classifier and the distrust-never-revert rule, and the
 * script must exist in every mirror the plugin build produces.
 *
 * Assertions run against whitespace-flattened text so markdown line wrapping
 * cannot break them, and so no assertion needs a backtracking-prone regex.
 * @module tests/unit/strategies/lifecycle-label-trust-contract
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { flatten } from "./support/lifecycle-label-trust.js";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const BUILD_INTAKE = "skills/lisa-github-build-intake/SKILL.md";
const REPAIR_INTAKE = "skills/lisa-repair-intake/SKILL.md";
const SCRIPT = "scripts/lifecycle-label-trust.mjs";
const FLAP = "label-flap loop";

const read = (root: string, relative: string): string =>
  flatten(readFileSync(path.resolve(root, relative), "utf8"));

describe("lifecycle-label trust contract (#2539)", () => {
  describe.each(ROOTS)("%s", root => {
    it("ships the classifier script alongside the skills that call it", () => {
      expect(existsSync(path.resolve(root, SCRIPT))).toBe(true);
    });

    it("makes build-intake resolve label trust before believing a label", () => {
      const skill = read(root, BUILD_INTAKE);

      expect(skill).toContain("Lifecycle-label trust resolution");
      expect(skill).toContain(SCRIPT);
      expect(skill).toContain(
        "Use `trusted` wherever this skill would otherwise read the raw label set"
      );
    });

    it("refuses to claim on a bot-applied ready label", () => {
      const skill = read(root, BUILD_INTAKE);

      expect(skill).toContain("`$READY` is **untrusted** is **not claimable**");
      expect(skill).toContain("`$CLAIMED` is **untrusted** is **not claimed**");
    });

    it("forbids reverting the bot's label in both skills", () => {
      const intake = read(root, BUILD_INTAKE);
      const repair = read(root, REPAIR_INTAKE);

      expect(intake).toContain("Never unlabel to correct this");
      expect(intake).toContain(FLAP);
      expect(repair).toContain("do not unlabel and do not relabel");
      expect(repair).toContain(FLAP);
    });

    it("keeps the bot-label repair class read-only", () => {
      const repair = read(root, REPAIR_INTAKE);

      expect(repair).toContain(
        "Bot-authored lifecycle label → distrust, never revert"
      );
      expect(repair).toContain("deliberately **read-only**");
    });

    it("walks both lifecycle drift directions in one repair pass", () => {
      const repair = read(root, REPAIR_INTAKE);
      const section = repair.slice(
        repair.indexOf("Lifecycle label contradicts native state"),
        repair.indexOf("Bot-authored lifecycle label")
      );

      expect(section).toContain("terminal-label-open-state");
      expect(section).toContain("open-label-closed-state");
      expect(section).toContain("previously unowned direction");
      expect(section).toContain("TUN-556 and TUN-503");
    });

    it("names Linear's native state as authoritative over a stale label", () => {
      expect(read(root, REPAIR_INTAKE)).toContain(
        "never move the state to match a label"
      );
    });

    it("forbids a pinned status member set in both skills", () => {
      for (const relative of [BUILD_INTAKE, REPAIR_INTAKE]) {
        const skill = read(root, relative);

        expect(skill).toContain("pinned member list");
        expect(skill).toContain("drifted 7 → 6 members");
      }
    });
  });
});
