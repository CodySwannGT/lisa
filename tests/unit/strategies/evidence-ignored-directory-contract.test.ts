/**
 * Regression contract for CodySwannGT/lisa#4490: the verification rules and
 * the tracker-evidence wrapper must not assume `evidence/` is tracked. A host
 * that gitignores it gets no committed proof, so the guidance must branch on
 * `git check-ignore` and name the tracker comment + evidence-release uploads
 * as the durable record — in the source and in every generated agent copy.
 *
 * @module tests/unit/strategies/evidence-ignored-directory-contract
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

const EAGER_RULES = [
  "plugins/src/base/rules/eager/verification.md",
  "plugins/lisa/rules/eager/verification.md",
  "plugins/lisa-copilot/rules/eager/verification.md",
  "plugins/lisa-devin/rules/eager/verification.md",
  "plugins/lisa-cursor/rules/verification.mdc",
] as const;

const REFERENCE_RULES = [
  "plugins/src/base/rules/reference/verification.md",
  "plugins/lisa/rules/reference/verification.md",
  "plugins/lisa-copilot/rules/reference/verification.md",
  "plugins/lisa-devin/rules/reference/verification.md",
  "plugins/lisa-cursor/rules/verification-reference.mdc",
] as const;

const EVIDENCE_SKILLS = [
  "plugins/src/base/skills/lisa-tracker-evidence/SKILL.md",
  "plugins/lisa/skills/lisa-tracker-evidence/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-tracker-evidence/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-tracker-evidence/SKILL.md",
  "plugins/lisa-agy/skills/lisa-tracker-evidence/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-tracker-evidence/SKILL.md",
  "plugins/lisa-devin/skills/lisa-tracker-evidence/SKILL.md",
] as const;

describe("ignored evidence directory contract (#4490)", () => {
  describe.each(EAGER_RULES)("eager verification rule %s", file => {
    const text = read(file);

    it("checks whether evidence/<ticket>/ is ignored before calling it committed", () => {
      expect(text).toContain("git check-ignore -q evidence/<ticket>/");
      expect(text).toMatch(/Never call the evidence "committed"/);
    });

    it("names the tracker comment and evidence-release uploads as the durable record", () => {
      expect(text).toMatch(
        /tracker evidence comment plus every artifact uploaded to the evidence release/
      );
    });
  });

  describe.each(REFERENCE_RULES)("reference verification rule %s", file => {
    const text = read(file);

    it("documents the ignored-directory branch and its verdict shape", () => {
      expect(text).toContain("**When the repository ignores `evidence/`.**");
      expect(text).toContain('"evidenceCommitted": false');
      expect(text).toContain('"evidenceCommitted": true');
    });

    it("downgrades uncommitted digests to session-local anchors", () => {
      expect(text).toContain("**session-local integrity anchor**");
      expect(text).toMatch(
        /uploaded pr-assets copy when evidence\/ is gitignored/
      );
    });
  });

  describe.each(EVIDENCE_SKILLS)("tracker-evidence skill %s", file => {
    const text = read(file);

    it("runs check-ignore before dispatch and requires full-manifest upload", () => {
      expect(text).toContain('git check-ignore -q "$EVIDENCE_DIR"');
      expect(text).toMatch(/Upload \*\*every\*\* manifest artifact/);
      expect(text).toMatch(/Never describe ignored evidence as "committed"/);
    });
  });

  describe("the branch condition the rules rely on", () => {
    const scratch = mkdtempSync(path.join(tmpdir(), "lisa-4490-"));
    afterAll(() => rmSync(scratch, { recursive: true, force: true }));

    const GIT = boundedSpawnSync({
      label: "resolve git",
      command: "/usr/bin/env",
      args: ["sh", "-c", "command -v git"],
    }).stdout.trim();
    // Drop inherited GIT_* so a hook-run suite cannot redirect the scratch repo.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
    );
    const git = (cwd: string, ...args: string[]) =>
      boundedSpawnSync({
        label: `git ${args[0]}`,
        command: GIT,
        args,
        cwd,
        env,
      });

    const repoWith = (name: string, gitignore: string | null): string => {
      const dir = path.join(scratch, name);
      mkdirSync(path.join(dir, "evidence", "T-1"), { recursive: true });
      writeFileSync(path.join(dir, "evidence", "T-1", "verdict.json"), "{}\n");
      if (gitignore !== null)
        writeFileSync(path.join(dir, ".gitignore"), gitignore);
      git(dir, "init", "-q");
      return dir;
    };

    it("exits 0 and git add skips the evidence when evidence/ is gitignored", () => {
      const dir = repoWith("ignored", "evidence/\n");
      expect(git(dir, "check-ignore", "-q", "evidence/T-1/").status).toBe(0);
      git(dir, "add", "-A");
      const staged = git(dir, "diff", "--cached", "--name-only").stdout;
      expect(staged).not.toContain("evidence/T-1/verdict.json");
    });

    it("exits non-zero and git add stages the evidence when evidence/ is tracked", () => {
      const dir = repoWith("tracked", null);
      expect(git(dir, "check-ignore", "-q", "evidence/T-1/").status).toBe(1);
      git(dir, "add", "-A");
      const staged = git(dir, "diff", "--cached", "--name-only").stdout;
      expect(staged).toContain("evidence/T-1/verdict.json");
    });
  });
});
