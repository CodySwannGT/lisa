/**
 * A plumbing spelling of a blocked discard must be blocked too (#3978).
 *
 * Guard 3 refuses `git reset --hard`/`--merge` on a dirty working tree because
 * it silently destroys uncommitted work. `git read-tree -u --reset HEAD` has
 * the identical effect — it resets the index and writes the result into the
 * working tree — but carries no `--hard` and no `reset` subcommand, so every
 * pattern in guard 3 misses it.
 *
 * That asymmetry is the whole defect. A guard is not decorative here: it is the
 * control that stops an agent from destroying uncommitted work it did not
 * author, and an agent that hits the wall and looks for a way through finds the
 * plumbing form. The permitted spelling was strictly worse than the blocked
 * one — it discards WITHOUT preserving, which is exactly the property guard 3's
 * remedy exists to supply.
 *
 * ## Both arms, because a block alone can be bought too cheaply
 *
 * A blanket `read-tree` refusal would close the hole and break a safe,
 * ordinary operation: `read-tree` with no update flag touches the index only,
 * and `read-tree -m -u` without `--reset` is refused BY GIT rather than
 * allowed to clobber a modified file. So the permit arm is asserted as
 * seriously as the refuse arm — an over-broad guard has moved the defect
 * rather than fixed it, and the fixture table below fails on either mistake.
 *
 * ## Why the assertions run the hook in real repositories
 *
 * The verdict is conditional on working-tree state, so it cannot be read off
 * the source. Every case classifies a real command from a real clean or dirty
 * temp repository and reads the hook's exit status and stderr, which is what
 * the model sees.
 * @module tests/unit/hooks/parity-safety-net-plumbing-discard
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  createGuardHarness,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
} from "../../helpers/safety-net-guard-harness.js";

/** The destructive plumbing spelling this ticket closes. */
const DESTRUCTIVE_READ_TREE = "git read-tree -u --reset HEAD";

/** The porcelain command guard 3 already refuses, on the same condition. */
const DESTRUCTIVE_RESET = "git reset --hard HEAD";

/** Every shipped spelling of the same guard. All of them govern somewhere. */
const SHIPPED_COPIES: readonly string[] = [
  "plugins/src/base/hooks/parity-safety-net.sh",
  "plugins/lisa/hooks/parity-safety-net.sh",
  "plugins/lisa-agy/hooks/parity-safety-net.sh",
  "plugins/lisa-cursor/hooks/parity-safety-net.sh",
  "plugins/lisa-copilot/hooks/parity-safety-net.sh",
  "all/copy-overwrite/scripts/lisa-hooks/parity-safety-net.sh",
].map(relative => path.resolve(relative));

/** Fragments proving the per-worktree preserve remedy was actually offered. */
const PRESERVE_FRAGMENTS: readonly string[] = [
  "lisa-preserve-",
  "git diff --binary HEAD",
  "git apply",
];

const { makeRepo } = createGuardHarness(process.env);

/** One classification: the hook's exit status and what it told the reader. */
interface Verdict {
  readonly status: number | null;
  readonly stderr: string;
}

/**
 * Classifies one proposed command through a chosen shipped copy of the guard.
 *
 * Nothing is executed: the hook is a classifier over a command string handed
 * to it as PreToolUse JSON. `cwd` decides the working-tree state it probes.
 * @param command - The proposed shell command.
 * @param cwd - Repository the hook runs its dirty-tree probe in.
 * @param hook - Which shipped copy of the guard to ask.
 * @returns The hook's exit status and refusal text.
 */
const classify = (command: string, cwd: string, hook: string): Verdict => {
  const outcome = boundedSpawnSync({
    label: "parity-safety-net.sh",
    command: "/bin/bash",
    args: [hook],
    cwd,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
      ),
      CLAUDE_PROJECT_DIR: cwd,
      SAFETY_NET_RULES_FILE: path.join(cwd, "no-rules-here.txt"),
    },
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
  });

  return { status: outcome.status, stderr: outcome.stderr ?? "" };
};

/**
 * Strips the `Blocked by safety-net: <reason>` headline from a refusal.
 *
 * What remains is the guidance body — the part that teaches the remedy, and
 * the part the two refusals must share.
 * @param stderr - A refusal as the hook printed it.
 * @returns The guidance body, trimmed.
 */
const guidanceBody = (stderr: string): string =>
  stderr.split("\n").slice(1).join("\n").trim();

describe("parity-safety-net: the plumbing discard is refused too (#3978)", () => {
  let workRoot: string;
  let dirtyRepo: string;
  let cleanRepo: string;
  const shippedGuard = SHIPPED_COPIES[1] as string;

  beforeAll(() => {
    workRoot = mkdtempSync(path.join(tmpdir(), "lisa-plumbing-discard-"));
    dirtyRepo = makeRepo(workRoot, "dirty-repo", true);
    cleanRepo = makeRepo(workRoot, "clean-repo", false);
  });

  afterAll(() => {
    rmSync(workRoot, { recursive: true, force: true });
  });

  describe("the refuse arm", () => {
    it("refuses a destructive read-tree on a dirty working tree", () => {
      const { status } = classify(
        DESTRUCTIVE_READ_TREE,
        dirtyRepo,
        shippedGuard
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("names read-tree in the refusal, so the reader knows what matched", () => {
      // A refusal that names the wrong command sends the reader to fix
      // something they did not run.
      const { stderr } = classify(
        DESTRUCTIVE_READ_TREE,
        dirtyRepo,
        shippedGuard
      );

      expect(stderr).toContain("git read-tree");
    });

    it("teaches the identical remedy the reset refusal teaches", () => {
      // The ticket's point: the two refusals must not drift apart in what they
      // tell the reader to do, because they are refusing the same destruction.
      const plumbing = classify(DESTRUCTIVE_READ_TREE, dirtyRepo, shippedGuard);
      const porcelain = classify(DESTRUCTIVE_RESET, dirtyRepo, shippedGuard);

      expect(porcelain.status).toBe(EXIT_BLOCKED);
      expect(guidanceBody(plumbing.stderr)).toBe(
        guidanceBody(porcelain.stderr)
      );
    });

    it("actually offers the per-worktree preserve remedy", () => {
      // Equality above is satisfied by two identically EMPTY bodies. This half
      // pins that the shared body is the remedy rather than nothing.
      const { stderr } = classify(
        DESTRUCTIVE_READ_TREE,
        dirtyRepo,
        shippedGuard
      );

      for (const fragment of PRESERVE_FRAGMENTS) {
        expect(stderr).toContain(fragment);
      }
    });
  });

  describe("the permit arm — the fix must not have moved the defect", () => {
    it("permits an index-only read-tree on the same dirty tree", () => {
      // No update flag: the working tree is never written, so there is nothing
      // to discard and nothing to refuse.
      const { status, stderr } = classify(
        "git read-tree --reset HEAD",
        dirtyRepo,
        shippedGuard
      );

      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).not.toContain("Blocked by safety-net");
    });

    it("permits read-tree -m -u without --reset on a dirty tree", () => {
      // Safe by git's own construction: a merge read-tree REFUSES rather than
      // overwrite a locally modified file. `--reset` is the flag that switches
      // that refusal off, which is why it is the discriminator.
      const { status } = classify(
        "git read-tree -m -u HEAD",
        dirtyRepo,
        shippedGuard
      );

      expect(status).toBe(EXIT_ALLOWED);
    });

    it("permits the destructive spelling on a clean tree", () => {
      // Same conditional shape as guard 3: with nothing uncommitted there is
      // nothing to lose, and blocking it would break an ordinary workflow.
      const { status } = classify(
        DESTRUCTIVE_READ_TREE,
        cleanRepo,
        shippedGuard
      );

      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("negative controls — the harness is not answering one way", () => {
    it("produces both verdicts from the same dirty repository", () => {
      const verdicts = new Set([
        classify("git status --short", dirtyRepo, shippedGuard).status,
        classify(DESTRUCTIVE_READ_TREE, dirtyRepo, shippedGuard).status,
      ]);

      expect(verdicts).toEqual(new Set([EXIT_ALLOWED, EXIT_BLOCKED]));
    });
  });

  describe("every shipped copy closes the same hole", () => {
    it.each(SHIPPED_COPIES)("%s refuses it on a dirty tree", copy => {
      // The guard is regenerated into per-agent plugin copies and the host
      // copy-overwrite tree. A fix that reaches only the base source leaves
      // every consumer still walking around it.
      const { status, stderr } = classify(
        DESTRUCTIVE_READ_TREE,
        dirtyRepo,
        copy
      );

      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("lisa-preserve-");
    });

    it.each(SHIPPED_COPIES)("%s still permits the index-only form", copy => {
      expect(
        classify("git read-tree --reset HEAD", dirtyRepo, copy).status
      ).toBe(EXIT_ALLOWED);
    });
  });
});
