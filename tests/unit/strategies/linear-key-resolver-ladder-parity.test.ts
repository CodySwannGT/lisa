/**
 * Parity coverage for the `read_linear_key()` resolver ladder.
 *
 * Two skills define their own full copy of `read_linear_key()` —
 * `lisa-linear-access` (the access chokepoint) and `lisa-setup-linear` (the
 * guided setup flow) — and each is fanned out to six surfaces, so the ladder
 * exists twelve times. Its correctness was guarded only by a comment saying
 * "keep this identical", which is not a gate. The two copies previously
 * diverged, and later accepted checkout-local executables as trusted merely
 * because they occupied a familiar generated destination.
 *
 * These assertions turn that comment into a check. They compare the two
 * ladders rung-for-rung on every surface rather than asserting a hardcoded
 * list twice, so a future rung added to one skill fails here until it is added
 * to the other — which is the property that was actually missing.
 * @module tests/unit/strategies/linear-key-resolver-ladder-parity
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Every surface the two skills are fanned out to. */
const SURFACES = [
  "plugins/src/base",
  "plugins/lisa",
  "plugins/lisa/.codex-plugin",
  "plugins/lisa-agy",
  "plugins/lisa-copilot",
  "plugins/lisa-cursor",
] as const;

const ACCESS = "lisa-linear-access";
const SETUP = "lisa-setup-linear";

/** Filename every rung ends at, and the point each token is truncated to. */
const RESOLVER = "resolve-secret.mjs";

/**
 * The trusted rungs the ladder must offer, in order. Checkout-local paths are
 * intentionally absent: repository-controlled code cannot become trusted only
 * by living under a generated destination. `node_modules` is the final floor
 * that needs no environment variable at all.
 */
const REQUIRED_RUNGS = [
  "$CLAUDE_PLUGIN_ROOT/skills/lisa-secrets-access/scripts/resolve-secret.mjs",
  "$PLUGIN_ROOT/skills/lisa-secrets-access/scripts/resolve-secret.mjs",
  "node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-secrets-access/scripts/resolve-secret.mjs",
] as const;

const readSkill = (surface: string, skill: string): string =>
  readFileSync(path.resolve(surface, `skills/${skill}/SKILL.md`), "utf8");

/**
 * Pull the ordered resolver paths out of a skill's `read_linear_key()` body.
 *
 * Reads the paths themselves rather than the surrounding shell so the two
 * copies can keep the structural differences they legitimately have — the
 * access skill fails loudly at the end of the ladder, the setup skill falls
 * through to its legacy keychain rung — while still being held to the same
 * rungs in the same order.
 * @param skill Full text of a `SKILL.md` that defines `read_linear_key()`.
 * @returns The resolver paths the ladder tries, in the order it tries them.
 */
const ladderOf = (skill: string): readonly string[] => {
  const start = skill.indexOf("read_linear_key() {");
  const body = skill.slice(Math.max(start, 0));
  const end = body.search(
    /\n(?:linear_graphql\(\) \{|KEY=\$\(read_linear_key)/u
  );
  // Comment lines mention `resolve-secret.mjs` in prose; only executable lines
  // carry rungs, so drop the comments before reading rather than trying to
  // out-clever the prose with a smarter pattern.
  const code = body
    .slice(0, Math.max(end, 0))
    .split("\n")
    .filter(line => !line.trimStart().startsWith("#"))
    .join("\n");
  // Whitespace-split rather than a `\S*`-anchored scan: the same rungs are
  // reachable by splitting on whitespace, and it cannot backtrack.
  const rungs = code
    .split(/\s+/u)
    // Peel the shell that carries the path — an array append, quotes, a
    // trailing separator — so a rung compares equal whether it is a bare word
    // in a `for` list or a quoted `candidates+=(...)` push. The tail is cut by
    // truncating at the filename rather than by a trailing-character regex,
    // which would be the super-linear-backtracking shape.
    .map(token =>
      token.replace(/^candidates\+=\(/u, "").replace(/^["'(]+/u, "")
    )
    .filter(token => token.includes(RESOLVER))
    .map(token => token.slice(0, token.indexOf(RESOLVER) + RESOLVER.length));

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(0);
  return rungs;
};

describe("read_linear_key resolver ladder parity", () => {
  describe.each(SURFACES)("%s", surface => {
    const accessLadder = ladderOf(readSkill(surface, ACCESS));
    const setupLadder = ladderOf(readSkill(surface, SETUP));

    it("offers every documented rung, in order, from lisa-linear-access", () => {
      expect(accessLadder).toStrictEqual([...REQUIRED_RUNGS]);
    });

    it("offers every documented rung, in order, from lisa-setup-linear", () => {
      // The two copies previously diverged and must retain the same trust
      // boundary.
      expect(setupLadder).toStrictEqual([...REQUIRED_RUNGS]);
    });

    it("keeps the two copies rung-for-rung identical", () => {
      // Ordering is load-bearing, not incidental: a repo that vendors the
      // resolver has declared which copy it wants used, so the repo-relative
      // rungs must keep leading the plugin-owned ones. Comparing the arrays
      // rather than set membership is what pins that.
      expect(setupLadder).toStrictEqual(accessLadder);
    });

    it("does not execute checkout-local resolver copies", () => {
      for (const ladder of [accessLadder, setupLadder]) {
        expect(ladder).not.toContain(
          ".claude/skills/lisa-secrets-access/scripts/resolve-secret.mjs"
        );
        expect(ladder).not.toContain(
          ".agents/skills/lisa-secrets-access/scripts/resolve-secret.mjs"
        );
      }
    });

    it("names every path it tried when the whole ladder misses", () => {
      // Diagnostics are part of the parity, not decoration. A ladder that
      // fails silently sends the next reader hunting for a resolver they
      // cannot see the absence of, which is most of the cost of this class of
      // bug. Both skills must enumerate, and neither may print a value.
      for (const skill of [
        readSkill(surface, ACCESS),
        readSkill(surface, SETUP),
      ]) {
        expect(skill).toContain("Tried, in order (relative paths are from");
        expect(skill).toContain("printf '  %s\\n' \"${tried[@]}\"");
      }
    });

    it("ends at a rung that needs no environment variable", () => {
      // The plugin-root rungs are opportunistic: neither CLAUDE_PLUGIN_ROOT nor
      // PLUGIN_ROOT is exported into an agent's plain shell call, so a ladder
      // whose only $PWD-independent rungs were those two would resolve nothing
      // in the environment this actually runs in. The installed-package rung is
      // the floor that does not depend on the host setting anything.
      for (const ladder of [accessLadder, setupLadder]) {
        expect(ladder.at(-1)).toBe(
          "node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-secrets-access/scripts/resolve-secret.mjs"
        );
      }
    });
  });

  it("states the invariant as the ladder, not the whole function", () => {
    // The old wording ("Keep this identical to `linear-access`") described
    // something unachievable — the two functions have different tails by
    // design — and an unachievable rule is one that gets quietly dropped,
    // which is how the ladders forked in the first place.
    const setup = readSkill("plugins/src/base", SETUP);
    expect(setup).toMatch(/ladder[\s\S]{0,120}identical to `linear-access`/iu);
  });
});
