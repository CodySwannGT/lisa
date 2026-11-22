/**
 * Regression contract for CodySwannGT/lisa#4490: the verification rules and
 * the tracker-evidence wrapper must not assume `evidence/` is tracked. A host
 * that gitignores the directory, or a file pattern its artifacts use, gets no
 * committed proof, so the guidance branches on `git ls-files --ignored`.
 *
 * The guidance prose is reviewed, not pinned. What stays here is the behaviour
 * that guidance relies on: real git, in scratch repositories, proving the
 * branch condition reports each case the way the rules assume.
 * @module tests/unit/strategies/evidence-ignored-directory-contract
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const TICKET_DIR = "evidence/T-1/";
const VERDICT_PATH = `${TICKET_DIR}verdict.json`;
const SCREENSHOT_PATH = `${TICKET_DIR}01-step.png`;

describe("ignored evidence contract (#4490)", () => {
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
