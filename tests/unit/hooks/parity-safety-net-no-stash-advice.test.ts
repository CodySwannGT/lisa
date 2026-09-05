/**
 * No shipped guard may recommend `git stash` as the way to preserve work.
 *
 * ## Why the advice is dangerous here
 *
 * The stash is ONE STACK PER CLONE, shared by every worktree. This repository
 * routinely runs many agents against one `.git`, so a `git stash push` in one
 * session and a `git stash pop` in another are a race over work neither can
 * see, and `lint-staged` pushes an entry on every commit so agent and tooling
 * entries interleave. A guard's message fires at the exact moment an agent is
 * holding the work most worth protecting, and a guard's own output reads as
 * authoritative — so pointing it at shared mutable state is worse than the
 * refusal it accompanies.
 *
 * ## What this suite proves, stated precisely
 *
 * Issue #3722 already rewrote guards 3 and 4 to point at `PRESERVE_GUIDANCE`
 * instead of the stash. **So the file-scan cases below pass on the tree as it
 * stood before this ticket, and they are a REGRESSION GUARD on that fix rather
 * than a probe of a live defect.** They are here because nothing pinned it:
 * #3722 changed the strings and left no control preventing the next edit from
 * reintroducing them.
 *
 * The one case that DOES go red without this ticket's change is the stale
 * comment on guard 7, which still called stash push/pop "the safe alternatives
 * the reset guard recommends" after #3722 had removed that recommendation. A
 * comment asserting the opposite of what the file does is the same hazard as a
 * message doing it — the next reader takes the file's word for what the file
 * does — which is why it is checked here alongside the messages.
 *
 * ## Why this keys on ADVISORY forms, not the bare word
 *
 * Guard 7 legitimately BLOCKS `git stash drop` / `git stash clear`, and its
 * message necessarily contains the word. That is a prohibition, not a
 * recommendation, and it must stay. Keying on the bare token would fail on the
 * one message doing the right thing. Do not "tighten" these patterns to
 * /stash/.
 *
 * ## Bite evidence
 *
 * Per CodySwannGT/lisa#3111 a shell guard cannot be mutation-tested, so a
 * payload table with controls on BOTH sides is the available evidence. Both
 * sides are here: the advisory forms must be absent, AND the guard must still
 * refuse the commands and still carry the replacement remedy — a suite
 * asserting only an absence would pass against a guard that had stopped
 * refusing anything at all.
 * @module tests/unit/hooks/parity-safety-net-no-stash-advice
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

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

/**
 * Spellings that RECOMMEND the shared stash rather than prohibiting it.
 *
 * **Every pattern here was verified against the real historical bytes, in both
 * directions** — it matches the text that shipped before the fix and does not
 * match the text that shipped after. That check is not ceremony: the first
 * draft of this table required "stash" to appear AFTER "safe alternatives",
 * and in guard 7's actual comment it appears before, so the pattern matched
 * nothing and the suite passed against the very file it was written to catch.
 * A prose pattern that has not been run against the prose it forbids is not
 * evidence of anything. If you add one, revert the relevant file to the commit
 * that carried the bad text and watch the case go red first.
 *
 * The first three were the shipped refusal text of guards 4 and 3 until #3722;
 * the fourth is guard 7's comment, which #3722 left behind and #3692 removed.
 */
const ADVISORY: readonly (readonly [string, RegExp])[] = [
  ["guard 4's old refusal", /use\s+git\s+stash/i],
  ["guard 3's old refusal", /\(\s*stash\s+or\s+commit/i],
  ["stash offered as the preservation step", /stash\s+to\s+preserve/i],
  ["push/pop called a safe alternative", /push\/pop[^.]*safe\s+alternatives?/i],
];

/**
 * Classify one proposed command. Nothing is executed — the hook is a
 * classifier over a command string handed to it as PreToolUse JSON.
 * @param command - The proposed shell command
 * @returns The hook's exit status and refusal text
 */
function classify(command: string): {
  readonly status: number | null;
  readonly stderr: string;
} {
  const outcome = boundedSpawnSync({
    label: "parity-safety-net.sh",
    command: "/bin/bash",
    args: [HOOK_PATH],
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: process.cwd(),
    }),
    env: process.env,
  });
  return { status: outcome.status, stderr: outcome.stderr ?? "" };
}

describe("no shipped guard recommends the shared stash", () => {
  for (const copy of SHIPPED_COPIES) {
    const name = path.relative(process.cwd(), copy);
    for (const [label, pattern] of ADVISORY) {
      it(`${name} carries no ${label}`, () => {
        expect(readFileSync(copy, "utf8")).not.toMatch(pattern);
      });
    }
  }

  it("still BLOCKS git stash drop, whose message names stash as a prohibition", () => {
    // The prohibition side. This is why the patterns above are advisory-shaped
    // rather than the bare word: this message must keep saying "stash".
    const verdict = classify("git stash drop");

    expect(verdict.status).toBe(EXIT_BLOCKED);
    expect(verdict.stderr).toMatch(/stash/i);
  });
});

/**
 * The exact command the merge driver used to print, which guard 4 refuses.
 * That pairing is the whole of CodySwannGT/lisa#3692.
 */
const DISCARDING_CHECKOUT = "git checkout --theirs -- generated/manifest.ts";

describe("the discard refusal hands over a remedy that is safe here", () => {
  const verdict = classify(DISCARDING_CHECKOUT);

  it("still refuses the command — this ticket moves no verdict", () => {
    expect(verdict.status).toBe(EXIT_BLOCKED);
  });

  it("tells the reader not to use the stash, and why", () => {
    expect(verdict.stderr).toMatch(/Do NOT reach for `git stash`/);
    expect(verdict.stderr).toMatch(/shared by every worktree/);
  });

  it("names a per-worktree way to preserve the work first", () => {
    expect(verdict.stderr).toContain("git diff --binary HEAD");
    expect(verdict.stderr).toContain("git apply");
  });

  it("keeps the inherited quoted-content remedy from the default guidance", () => {
    // Regression guard for the append-not-replace decision at the call sites:
    // block()'s second argument REPLACES $DESTRUCTIVE_GUIDANCE, so passing the
    // preservation text alone would silently drop this remedy.
    expect(verdict.stderr).toContain("--body-file");
  });
});
