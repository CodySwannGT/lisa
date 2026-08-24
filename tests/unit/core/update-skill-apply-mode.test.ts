/**
 * The fleet-update skill must not instruct a `postinstall-safe` apply (#3066).
 *
 * Every tracked copy of `lisa-update-projects` documented the apply as:
 *
 *     LISA_BOOTSTRAP=1 node node_modules/@codyswann/lisa/dist/index.js \
 *       --yes --skip-git-check .
 *
 * `--skip-git-check` is what selects `postinstall-safe` mode
 * (`src/core/lisa.ts`, `config.skipGitCheck || this.selfApply`), which
 * deliberately skips every agent emit and the Sonar integration. So the
 * documented fleet-update procedure performed none of that work — and since it
 * is the only apply an update runs, the work never happened at all. Three
 * consumer repositories carried doctor's *"Legacy pre-2.198 Codex overlay
 * present"* finding across every update for months, each having run exactly
 * this command every time; dropping the flag removed 478, 322 and 660 stale
 * files respectively, every one of them under `.codex/`.
 *
 * `README.md` has said the correct thing throughout — *"no `bun install` at any
 * version can reconcile `.codex/config.toml`; only a full `lisa apply .`
 * does"* — and `src/core/apply-receipt.ts` documents the mode's cost in detail.
 * The skill was the only place that got it wrong, and the only place that is
 * executed.
 *
 * The assertion is deliberately about the INVOCATION, not about the string
 * `--skip-git-check`. The corrected skill names the flag several times in order
 * to warn against it, and a test that banned the mention would push the next
 * author toward deleting the warning rather than keeping the fix.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/core/update-skill-apply-mode
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Repository root, resolved from this file rather than from cwd. */
const ROOT = path.resolve(__dirname, "../../..");

/** Every tracked copy of the fleet-update skill. */
const SKILL_COPIES = [
  ".claude/skills/lisa-update-projects/SKILL.md",
  ".agents/skills/lisa-update-projects/SKILL.md",
  ".claude-pr/.claude/skills/lisa-update-projects/SKILL.md",
] as const;

/**
 * Matches an apply invocation that passes the mode-selecting flag.
 *
 * Anchored on `index.js` so it fires on a command a reader would run, and not
 * on prose that names the flag while telling them not to pass it.
 */
const SAFE_MODE_INVOCATION = /index\.js(?:\s+--[\w-]+)*\s+--skip-git-check/;

describe("lisa-update-projects skill", () => {
  it("has every copy present, so a renamed path cannot empty this file", () => {
    // A missing copy would make the assertion below vacuously true — the same
    // silent-zero failure the skill's own bug had.
    const missing = SKILL_COPIES.filter(
      rel => !existsSync(path.join(ROOT, rel))
    );
    expect(missing).toEqual([]);
  });

  it("never instructs an apply that passes --skip-git-check", () => {
    const offenders = SKILL_COPIES.filter(rel =>
      SAFE_MODE_INVOCATION.test(readFileSync(path.join(ROOT, rel), "utf8"))
    );

    // Stated over every copy: one stale copy is enough to send an operator
    // back to the reduced apply, and the copies drift independently.
    expect(offenders).toEqual([]);
  });

  it("tells the operator to verify the receipt records a full apply", () => {
    // The reduced apply still produces a plausible-looking `git status` diff,
    // so "check the diff appeared" cannot distinguish the two modes. The
    // receipt can, and is the only check that does.
    const withoutReceiptCheck = SKILL_COPIES.filter(
      rel =>
        !readFileSync(path.join(ROOT, rel), "utf8").includes(
          `"apply_mode": "full"`
        )
    );
    expect(withoutReceiptCheck).toEqual([]);
  });
});
