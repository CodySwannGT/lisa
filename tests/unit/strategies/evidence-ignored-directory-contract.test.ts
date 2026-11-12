/**
 * Regression contract for CodySwannGT/lisa#4490: the verification rules and
 * the tracker-evidence wrapper must not assume `evidence/` is tracked. A host
 * that gitignores the directory, or a file pattern its artifacts use, gets no
 * committed proof, so the guidance must branch on `git ls-files --ignored`,
 * fail closed when that check errors, and name the tracker comment plus
 * evidence-release uploads as the durable record — in the source and in every
 * generated agent copy.
 * @module tests/unit/strategies/evidence-ignored-directory-contract
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

const TICKET_DIR = "evidence/T-1/";
const VERDICT_PATH = `${TICKET_DIR}verdict.json`;
const SCREENSHOT_PATH = `${TICKET_DIR}01-step.png`;

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

const CLAIM_EVIDENCE_RULES = [
  "plugins/src/base/rules/reference/claim-evidence-mapping.md",
  "plugins/lisa/rules/reference/claim-evidence-mapping.md",
  "plugins/lisa-copilot/rules/reference/claim-evidence-mapping.md",
  "plugins/lisa-devin/rules/reference/claim-evidence-mapping.md",
  "plugins/lisa-cursor/rules/claim-evidence-mapping-reference.mdc",
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

describe("ignored evidence contract (#4490)", () => {
  describe.each(EAGER_RULES)("eager verification rule %s", file => {
    const text = read(file);

    // The eager tier is byte-budgeted, so it carries only the pointer; the
    // full branch lives in the reference rule asserted below.
    it("points at the ignored-evidence check before calling evidence committed", () => {
      expect(text).toMatch(/Git may ignore evidence/);
      expect(text).toMatch(
        /run the reference rule's ignored-evidence check first/
      );
      expect(text).toMatch(/never call ignored evidence committed/);
    });
  });

  describe.each(REFERENCE_RULES)("reference verification rule %s", file => {
    const text = read(file);

    it("documents all three outcomes of the check and the verdict field", () => {
      expect(text).toContain("**When the repository ignores evidence.**");
      expect(text).toContain('"evidence_committed": false');
      expect(text).toContain('"evidence_committed": true');
      expect(text).toContain("evidence_committed: true");
      expect(text).toMatch(
        /\*\*It exits non-zero\.\*\* The check itself failed/
      );
      expect(text).toMatch(/An empty result for a missing or mistyped/);
    });

    it("downgrades uncommitted digests to session-local anchors", () => {
      expect(text).toContain("**session-local integrity anchor**");
      expect(text).toMatch(
        /uploaded evidence-release copy when git ignores the evidence/
      );
    });
  });

  describe.each(CLAIM_EVIDENCE_RULES)(
    "claim-evidence-mapping rule %s",
    file => {
      const text = read(file);

      it("defines sha256 for uploaded copies and recomputes against fetched bytes", () => {
        expect(text).toMatch(
          /or of its uploaded evidence-release copy when git ignores the evidence/
        );
        expect(text).toMatch(/of the bytes fetched from that URL/);
      });
    }
  );

  describe.each(EVIDENCE_SKILLS)("tracker-evidence skill %s", file => {
    const text = read(file);

    it("runs the ignored-evidence check before dispatch and fails closed on error", () => {
      expect(text).toContain(
        'git ls-files --others --ignored --exclude-standard -- "$EVIDENCE_DIR"'
      );
      expect(text).toMatch(/never read it as "tracked"/);
    });

    it("uploads every manifest artifact under a ticket-scoped name to the resolved release", () => {
      expect(text).toMatch(
        /Upload every manifest artifact except `verdict.json`/
      );
      expect(text).toMatch(/`<ticket>` is a `\[a-z0-9-\]` slug/);
      expect(text).toContain('gh release upload "$RELEASE" <copies> --clobber');
      expect(text).toMatch(/If any upload fails, stop before dispatching/);
      expect(text).toContain("pr-<PR_NUMBER>-<ticket>-<file>");
      expect(text).toContain("<IDENTIFIER>-<file>");
      expect(text).toMatch(/Never hard-code `pr-assets`/);
      expect(text).toMatch(/Never describe ignored evidence as "committed"/);
    });
  });

  describe("the branch condition the rules rely on", () => {
    // Drop inherited GIT_* so a hook-run suite cannot redirect the scratch repo.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
    );
    const state = { scratch: "", git: "" };

    beforeAll(() => {
      state.scratch = mkdtempSync(path.join(tmpdir(), "lisa-4490-"));
      state.git = boundedSpawnSync({
        label: "resolve git",
        command: "/usr/bin/env",
        args: ["sh", "-c", "command -v git"],
      }).stdout.trim();
    });
    afterAll(() => rmSync(state.scratch, { recursive: true, force: true }));

    const git = (cwd: string, ...args: string[]) =>
      boundedSpawnSync({
        label: `git ${args[0]}`,
        command: state.git,
        args,
        cwd,
        env,
      });
    const ignoredEvidence = (dir: string, target = TICKET_DIR) =>
      git(
        dir,
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--",
        target
      );
    const staged = (dir: string): string => {
      expect(git(dir, "add", "-A").status).toBe(0);
      return git(dir, "diff", "--cached", "--name-only").stdout;
    };
    const repoWith = (name: string, gitignore: string | null): string => {
      const dir = path.join(state.scratch, name);
      mkdirSync(path.join(dir, "evidence", "T-1"), { recursive: true });
      writeFileSync(path.join(dir, "evidence", "T-1", "verdict.json"), "{}\n");
      writeFileSync(path.join(dir, "evidence", "T-1", "01-step.png"), "png\n");
      if (gitignore !== null) {
        writeFileSync(path.join(dir, ".gitignore"), gitignore);
      }
      git(dir, "init", "-q");
      return dir;
    };

    it("lists the evidence and git add skips it when evidence/ is gitignored", () => {
      const dir = repoWith("ignored-dir", "evidence/\n");
      const result = ignoredEvidence(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(VERDICT_PATH);
      expect(staged(dir)).not.toContain(TICKET_DIR);
    });

    it("catches a per-file ignore that a directory-level check-ignore misses", () => {
      const dir = repoWith("ignored-png", "*.png\n");
      expect(git(dir, "check-ignore", "-q", TICKET_DIR).status).toBe(1);
      const result = ignoredEvidence(dir);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(SCREENSHOT_PATH);
      const files = staged(dir);
      expect(files).toContain(VERDICT_PATH);
      expect(files).not.toContain(SCREENSHOT_PATH);
    });

    it("prints nothing and git add stages everything when nothing is ignored", () => {
      const dir = repoWith("tracked", null);
      const result = ignoredEvidence(dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      const files = staged(dir);
      expect(files).toContain(VERDICT_PATH);
      expect(files).toContain(SCREENSHOT_PATH);
    });

    it("exits non-zero when the path is outside the repository", () => {
      const dir = repoWith("outside", null);
      expect(ignoredEvidence(dir, state.scratch).status).not.toBe(0);
    });
  });
});
