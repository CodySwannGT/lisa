/**
 * A refusal that says "preserve your work first" must name a SAFE way to do it.
 *
 * The guard refuses operations that would discard uncommitted changes, and it
 * used to tell the reader to stash first (CodySwannGT/lisa#3722). On a
 * single-checkout repository that is ordinary advice. Here it is the most
 * dangerous operation available: the stash is ONE STACK PER CLONE, shared by
 * every worktree, so with concurrent agents a sibling's push shifts your entry
 * and a sibling's pop consumes it. `lint-staged` pushes one on every commit, so
 * agent and tooling entries interleave without anyone typing `stash`.
 *
 * What makes it worse than ordinary bad advice is WHEN it arrives: at the exact
 * moment an agent is holding the work most worth protecting, blocked, looking
 * for a sanctioned way forward — and a guard's own output reads as
 * authoritative, because it is the guard stating what it wants. **A remedy that
 * destroys the work the refusal exists to protect is worse than no remedy.**
 *
 * ## Why the assertions run the hook instead of reading the file
 *
 * The discriminating test is the refusal path itself. A suite that exercises
 * only the allowed path never renders a remedy at all and is satisfied by any
 * text whatsoever — including the text this suite exists to forbid. So every
 * assertion below classifies a real command and reads what the hook actually
 * printed to stderr, which is what the model sees.
 *
 * ## Both halves, because the negative alone is vacuous
 *
 * "Does not recommend the stash" is satisfied by printing nothing. So each case
 * asserts the absence of the unsafe advice AND the presence of the per-worktree
 * alternative. Removing either half leaves a passing suite over a useless
 * remedy.
 *
 * Note the absence assertions cannot simply forbid the substring `git stash`:
 * the replacement text names it in order to warn against it. They forbid the
 * RECOMMENDING spellings instead.
 * @module tests/unit/hooks/parity-safety-net-preserve-remedy
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** The BUILT hook, which is what consumers receive. */
const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");

/** Every shipped spelling of the same guard. All of them govern somewhere. */
const SHIPPED_COPIES: readonly string[] = [
  "plugins/src/base/hooks/parity-safety-net.sh",
  "plugins/lisa/hooks/parity-safety-net.sh",
  "plugins/lisa-agy/hooks/parity-safety-net.sh",
  "plugins/lisa-cursor/hooks/parity-safety-net.sh",
  "plugins/lisa-copilot/hooks/parity-safety-net.sh",
  "all/copy-overwrite/scripts/lisa-hooks/parity-safety-net.sh",
].map(relative => path.resolve(relative));

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

/** The recursive-delete syntax, assembled so this file is not itself a match. */
const DELETE = `${"r"}${"m"} -${"r"}${"f"}`;

/** One classification: the hook's exit status and what it told the reader. */
interface Verdict {
  readonly status: number | null;
  readonly stderr: string;
}

/**
 * Classify one proposed command. Nothing is executed — the hook is a classifier
 * over a command string handed to it as PreToolUse JSON.
 * @param command The proposed shell command.
 * @param hook Which shipped copy of the guard to ask.
 * @returns The hook's exit status and refusal text.
 */
const classify = (command: string, hook: string = HOOK_PATH): Verdict => {
  const outcome = boundedSpawnSync({
    label: "parity-safety-net.sh",
    command: "/bin/bash",
    args: [hook],
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: process.cwd(),
    }),
    env: process.env,
  });

  return { status: outcome.status, stderr: outcome.stderr ?? "" };
};

/**
 * Discarding operations that refuse unconditionally.
 *
 * `git reset --hard` is deliberately NOT here: it refuses only when the hook's
 * own working tree is dirty, so a rendered assertion on it would pass or fail
 * with the state of the checkout the suite happens to run in. It shares the one
 * guidance constant with these, so pinning the rendered text here covers it —
 * and the static sweep at the bottom pins its reason string directly.
 */
const DISCARDING: readonly (readonly [string, string])[] = [
  ["a path-scoped checkout", "git checkout -- src/index.ts"],
  ["a forced checkout", "git checkout -f"],
  ["a bare-dot checkout", "git checkout ."],
];

/** Spellings that RECOMMEND the shared stash. None may appear in a refusal. */
const UNSAFE_ADVICE: readonly string[] = [
  "use git stash to preserve",
  "stash or commit first",
  "Commit or stash",
  "or stash it, first",
];

/** Fragments proving a per-worktree alternative was actually offered. */
const SAFE_REMEDY_FRAGMENTS: readonly string[] = [
  "lisa-preserve-",
  "mktemp",
  "git apply",
  "shared by every worktree",
];

describe("parity-safety-net: preserving work is offered safely (#3722)", () => {
  describe("the discarding refusals keep their verdict", () => {
    it.each(DISCARDING)("still refuses %s", (_label, command) => {
      // The matcher is not being widened or narrowed. This ticket changes a
      // message; if a verdict moves, the change is a defect rather than a fix.
      expect(classify(command).status).toBe(EXIT_BLOCKED);
    });
  });

  describe("the refusal does not point at the shared stash", () => {
    it.each(DISCARDING)(
      "names no stash recommendation for %s",
      (_l, command) => {
        const { stderr } = classify(command);

        for (const advice of UNSAFE_ADVICE) {
          expect(stderr).not.toContain(advice);
        }
      }
    );
  });

  describe("the refusal offers a per-worktree alternative", () => {
    // Without this half the suite above is satisfied by printing nothing at
    // all, which would be a guard that refuses and explains nothing.
    it.each(DISCARDING)("names the patch-file remedy for %s", (_l, command) => {
      const { stderr } = classify(command);

      for (const fragment of SAFE_REMEDY_FRAGMENTS) {
        expect(stderr).toContain(fragment);
      }
    });

    it("explains WHY the stash is unsafe, not merely that it is", () => {
      // An unexplained prohibition gets rationalised around by the next agent
      // in a hurry. The reason is the part that survives.
      //
      // Whitespace-tolerant on purpose: the guidance is a wrapped heredoc, so
      // the phrase straddles a newline and a literal match would break on a
      // reflow that changed nothing about the meaning.
      expect(classify(DISCARDING[0]![1]!).stderr).toMatch(
        /shared by every worktree of a\s+clone/i
      );
    });
  });

  describe("negative controls — the harness is not answering one way", () => {
    it("still refuses a genuinely executing delete", () => {
      expect(classify(`${DELETE} /`).status).toBe(EXIT_BLOCKED);
    });

    it("permits a harmless command and prints no refusal", () => {
      const { status, stderr } = classify("echo hello");

      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).not.toContain("Blocked by safety-net");
    });

    it("produces both verdicts, so neither set is vacuous", () => {
      const verdicts = new Set([
        classify("git status --short").status,
        classify("git checkout -- src/index.ts").status,
      ]);

      expect(verdicts).toEqual(new Set([EXIT_ALLOWED, EXIT_BLOCKED]));
    });
  });

  describe("every shipped copy carries the safe remedy", () => {
    it.each(SHIPPED_COPIES)("%s renders it", copy => {
      const { status, stderr } = classify(DISCARDING[0]![1]!, copy);

      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("lisa-preserve-");
      for (const advice of UNSAFE_ADVICE) {
        expect(stderr).not.toContain(advice);
      }
    });

    it.each(SHIPPED_COPIES)("%s carries no stash advice anywhere", copy => {
      // Static, and deliberately so: it reaches the `git reset --hard` reason,
      // whose refusal is conditional on the running checkout being dirty and
      // therefore cannot be rendered deterministically here.
      const source = readFileSync(copy, "utf8");

      for (const advice of UNSAFE_ADVICE) {
        expect(source).not.toContain(advice);
      }
    });
  });
});
