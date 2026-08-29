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

import {
  type LadderSkill,
  runLadder,
  SOURCE,
} from "./credential-resolver-ladder-helpers";

/** Every surface the two skills are fanned out to. */
const SURFACES = [
  SOURCE,
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
    const setup = readSkill(SOURCE, SETUP);
    expect(setup).toMatch(/ladder[\s\S]{0,120}identical to `linear-access`/iu);
  });
});
/**
 * The environment rungs each copy consults before the resolver ladder starts.
 *
 * `ladderOf` above reads only `resolve-secret.mjs` paths, so everything the
 * function does BEFORE the ladder — the plain variable, then the per-workspace
 * one — was invisible to it. That blind spot is exactly where the two copies
 * forked: `lisa-setup-linear` documented and honoured `LINEAR_API_KEY_<slug>`
 * while `lisa-linear-access` never read it, so a workspace-scoped key set from
 * the setup instructions validated at setup time and then went unused by every
 * actual Linear call.
 * @param skill Full text of a `SKILL.md` that defines `read_linear_key()`.
 * @returns The credential variable names consulted, in order, without repeats.
 */
const envRungsOf = (skill: string): readonly string[] => {
  const start = skill.indexOf("read_linear_key() {");
  const body = skill.slice(Math.max(start, 0));
  // The prelude ends where the resolver ladder begins; `candidates=()` is the
  // first line of that ladder in both copies.
  const end = body.indexOf("local candidates=()");
  const code = body
    .slice(0, Math.max(end, 0))
    .split("\n")
    .filter(line => !line.trimStart().startsWith("#"))
    .join("\n");
  const names = code.match(/LINEAR_API_KEY(?:_\$\{slug\})?/gu) ?? [];
  return [...new Set(names)];
};

describe("read_linear_key environment-rung parity", () => {
  describe.each(SURFACES)("%s", surface => {
    it("consults the same credential variables, in the same order, in both copies", () => {
      // SE-527: `lisa-setup-linear` tells the reader to
      // `export LINEAR_API_KEY_$(echo "$WORKSPACE" | tr ...)` and honours it in
      // its own resolver. `lisa-linear-access` is the chokepoint every real
      // Linear operation goes through, so if it does not read the same
      // variable the documented affordance resolves nothing while the system
      // keeps working on some other credential — a silent wrong-identity path,
      // not an error.
      expect(envRungsOf(readSkill(surface, ACCESS))).toStrictEqual(
        envRungsOf(readSkill(surface, SETUP))
      );
    });

    it("reads the plain variable before the workspace-scoped one", () => {
      // Order is the contract: an explicitly exported `LINEAR_API_KEY` is the
      // narrowest, most deliberate override and must keep winning, exactly as
      // it does today.
      expect(envRungsOf(readSkill(surface, ACCESS))).toStrictEqual([
        "LINEAR_API_KEY",
        "LINEAR_API_KEY_${slug}",
      ]);
    });
  });

  it("matches the per-account form the remote-build skills promote", () => {
    // `lisa-analyze-claude-remote` reports Linear's env as
    // "LINEAR_API_KEY (or per-account LINEAR_API_KEY_<ws-slug>)" and
    // `lisa-generate-claude-remote-build-script` emits that suffixed name into
    // cloud-routine env templates. A routine configured from those skills with
    // only the suffixed name must be able to reach a key at all.
    const analyze = readSkill(SOURCE, "lisa-analyze-claude-remote");
    expect(analyze).toContain("LINEAR_API_KEY_<ws-slug>");
    expect(envRungsOf(readSkill(SOURCE, ACCESS))).toContain(
      "LINEAR_API_KEY_${slug}"
    );
  });
});

describe("read_linear_key honours the documented workspace-scoped variable", () => {
  /** Drives the access copy with a workspace slug, as the setup copy is driven. */
  const ACCESS_ENTRY: LadderSkill = {
    skill: ACCESS,
    fn: "read_linear_key",
    invoke: 'read_linear_key "acme"',
    credential: "LINEAR_API_KEY",
    keychain: false,
  };

  const PLUGIN_ROOT_RESOLVER =
    "plugin/skills/lisa-secrets-access/scripts/resolve-secret.mjs";

  it("returns the workspace-scoped value when it is the only key set", () => {
    const run = runLadder(ACCESS_ENTRY, [], {
      LINEAR_API_KEY_acme: "sentinel-from-workspace-var",
    });

    expect(run.stdout.trim()).toBe("sentinel-from-workspace-var");
    expect(run.status).toBe(0);
    // Proving the resolver was never consulted is the point: a ladder that
    // reached a provider and happened to get the same answer would look
    // identical on stdout alone.
    expect(run.invoked).toStrictEqual([]);
  });

  it("lets an explicit LINEAR_API_KEY still win over the workspace-scoped one", () => {
    const run = runLadder(ACCESS_ENTRY, [], {
      LINEAR_API_KEY: "explicit-override",
      LINEAR_API_KEY_acme: "workspace-scoped",
    });

    expect(run.stdout.trim()).toBe("explicit-override");
  });

  it("changes nothing when the workspace-scoped variable is unset", () => {
    // The degrade path: with neither variable set the ladder must walk to the
    // resolver and return its answer, exactly as it does today.
    const run = runLadder(
      ACCESS_ENTRY,
      [{ at: PLUGIN_ROOT_RESOLVER, answers: "value-from-plugin-copy" }],
      { CLAUDE_PLUGIN_ROOT: "plugin" }
    );

    expect(run.stdout.trim()).toBe("value-from-plugin-copy");
    expect(run.invoked).toStrictEqual([PLUGIN_ROOT_RESOLVER]);
  });

  it("ignores a variable scoped to a different workspace", () => {
    // A key for another workspace is not this workspace's key. Falling through
    // is correct; silently using it would be the wrong-identity write that
    // `credential-substrate-precedence` exists to prevent.
    const run = runLadder(ACCESS_ENTRY, [], {
      LINEAR_API_KEY_other: "key-for-a-different-workspace",
    });

    expect(run.stdout.trim()).toBe("");
    expect(run.status).not.toBe(0);
  });
});
