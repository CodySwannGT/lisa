/**
 * Whether a resolved guard copy can be seen to be old — before it refuses
 * anything, and without a network call.
 *
 * The companion to the attribution suite. Attribution is what an operator gets
 * once a refusal has already happened; this is the preventive half, and it
 * covers the three ways a copy's age can be misread:
 *
 *   - behind a newer Lisa sitting on the same disk,
 *   - carrying no version marker at all, which must not read as current,
 *   - shadowed by another tree, so it never runs and used to say nothing.
 *
 * It also holds the anti-inertness case. This campaign has closed four controls
 * that reported success while inert — one of them this very guard family,
 * permitting catastrophic deletes because a `grep` exiting 2 was read as "no
 * match" — so an empty resolution is proved by making it happen, not by
 * reading the branch that handles it.
 * @module tests/unit/hooks/enforcement-fallback-staleness
 */
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BEHIND,
  BLOCKED,
  CURRENT,
  GUARDS,
  HOST_TREE,
  PARITY_SAFETY_NET,
  PLUGIN_TREE,
  REPO_ROOT,
  bash,
  cleanupScratchRoots,
  dateHostTree,
  datePluginTree,
  installRealGuards,
  runFallback,
  scratchRoot,
} from "../../helpers/enforcement-fallback-fixtures.js";

afterEach(cleanupScratchRoots);

/** An ordinary tool call no guard has an opinion about. */
const HARMLESS = bash("ls -la");

/** The bypass a plugin-less session once got away with. */
const BYPASS = bash("git commit --no-verify -m x");

describe("a resolved copy carrying no version at all", () => {
  /**
   * Guards with no manifest and no receipt beside them — the state every host
   * that has not re-applied since this landed is in.
   * @returns The project root.
   */
  function rootWithUndateableGuards(): string {
    const root = scratchRoot();

    installRealGuards(path.join(root, HOST_TREE));
    return root;
  }

  it("is reported rather than read as current", () => {
    // An unversioned copy that stays quiet is indistinguishable from a fresh
    // one, which is the same invisibility by another road.
    const { output } = runFallback(HARMLESS, rootWithUndateableGuards());

    expect(output).toContain("vintage unknown");
  });

  it("still permits, because unknown age is not an offence", () => {
    // Refusing here would be a fleet-wide outage over a missing manifest.
    expect(runFallback(HARMLESS, rootWithUndateableGuards()).status).toBe(0);
  });

  it("carries the unknown vintage into the refusal too", () => {
    const { status, output } = runFallback(BYPASS, rootWithUndateableGuards());

    expect(status).toBe(BLOCKED);
    expect(output).toMatch(/Refused by .*\(vintage unknown\)/u);
  });
});

describe("a checkout whose copies are current", () => {
  it("says nothing about staleness", () => {
    // A notice on every tool call is a notice nobody reads. It fires only on a
    // tree that is behind or undateable.
    const root = scratchRoot();

    installRealGuards(path.join(root, PLUGIN_TREE));
    datePluginTree(root, CURRENT);

    const { status, output } = runFallback(HARMLESS, root);

    expect(status).toBe(0);
    expect(output).not.toContain("STALE");
    expect(output).not.toContain("behind");
  });
});

describe("the repair a stale tree is told to run", () => {
  it("tells a host tree to re-apply, because apply is what wrote it", () => {
    const root = scratchRoot();

    installRealGuards(path.join(root, HOST_TREE));
    dateHostTree(root, BEHIND);
    installRealGuards(path.join(root, PLUGIN_TREE));
    datePluginTree(root, CURRENT);

    const { output } = runFallback(HARMLESS, root);

    expect(output).toContain("npx @codyswann/lisa apply");
  });

  it("tells a plugin tree to move its checkout instead", () => {
    // `lisa apply` does not write `plugins/lisa/hooks/` — that tree is the Lisa
    // monorepo's own source, and a checkout is behind because of its branch.
    // Printing the apply command there is a remedy that cannot be followed.
    const root = scratchRoot();

    installRealGuards(
      path.join(root, HOST_TREE),
      GUARDS.filter(guard => guard !== PARITY_SAFETY_NET)
    );
    dateHostTree(root, CURRENT);
    installRealGuards(path.join(root, PLUGIN_TREE), [PARITY_SAFETY_NET]);
    datePluginTree(root, BEHIND);

    const { output } = runFallback(HARMLESS, root);

    expect(output).toContain("update this checkout");
    expect(output).toContain("does not refresh them");
  });
});

/** The heading a not-provably-current copy prints above its caveat. */
const CAVEAT = "THIS VERDICT MAY NOT REFLECT CURRENT SOURCE";

describe("a refusal from a copy that cannot be shown current", () => {
  // The preventive notice above is rate-limited PER SESSION, so a long-running
  // session receives it once, at the start. One session measured 2026-09-04 had
  // its notice written 34 hours before the refusals it existed to explain — and
  // its vintage was computed at start, when there was nothing yet to report, so
  // a session that begins current and goes stale while running is told nothing
  // at all (CodySwannGT/lisa#3942).
  //
  // These cases cover the other half: the warning keyed to the EVENT rather
  // than to the session, because staleness happens to a command.
  /**
   * A checkout whose host tree is behind a current plugin tree beside it.
   * @returns The scratch root, ready to hand to `runFallback`.
   */
  function staleHostTree(): string {
    const root = scratchRoot();

    installRealGuards(path.join(root, HOST_TREE));
    dateHostTree(root, BEHIND);
    installRealGuards(path.join(root, PLUGIN_TREE));
    datePluginTree(root, CURRENT);
    return root;
  }

  it("states that the verdict may not reflect current source", () => {
    const { status, output } = runFallback(BYPASS, staleHostTree());

    expect(status).toBe(BLOCKED);
    expect(output).toContain(CAVEAT);
  });

  it("tells the reader that re-running proves nothing", () => {
    // The load-bearing line. A refusal from a stale copy is indistinguishable
    // from one from current source, so the natural check — run it again —
    // returns a SECOND confirmation of the same wrong thing. Two tickets were
    // filed on 2026-09-04 against behaviour fixed the day before, one of them
    // re-verified live precisely to avoid citing a stale observation.
    const { output } = runFallback(BYPASS, staleHostTree());

    expect(output).toContain("Re-running the command confirms nothing");
    expect(output).toContain("read the guard on your");
  });

  it("names the repair for the tree that actually refused", () => {
    // Printing one repair for both trees hands half the fleet an instruction
    // that changes nothing (CodySwannGT/lisa#3191), and the refusal path can
    // get this wrong independently of the notice path.
    // The REFUSING tree has to be the stale one, which the obvious fixture gets
    // wrong: `BYPASS` is refused by block-no-verify, so leaving that guard in a
    // current host tree produces a refusal from a copy that IS current and no
    // caveat at all. Every guard therefore lives in the stale plugin tree here.
    // Staleness is only ever claimed against newer evidence on the same disk,
    // so a lone BEHIND tree is not stale — it is the newest thing there is.
    // The host tree is therefore DATED current while holding no guards, which
    // supplies that evidence without moving the refusal into a current copy.
    const root = scratchRoot();

    dateHostTree(root, CURRENT);
    installRealGuards(path.join(root, PLUGIN_TREE));
    datePluginTree(root, BEHIND);

    const { output } = runFallback(BYPASS, root);

    // Asserted on the text AFTER the caveat's own heading, not on the whole
    // output. The session-start notice prints this same repair string, so a
    // bare `toContain` passes against the unfixed guard — this test was written
    // that way first and proved nothing until running it against the pre-fix
    // code showed it green.
    const caveat = output.split(CAVEAT);

    expect(caveat).toHaveLength(2);
    expect(caveat[1]).toContain("update this checkout");
    expect(caveat[1]).not.toContain("npx @codyswann/lisa apply");
  });

  it("says none of it when the refusing copy is current", () => {
    // The over-breadth control, and the one that must pass BEFORE and AFTER.
    // Attaching the caveat to every refusal would train readers to skip it,
    // which is the failure mode the caveat exists to escape — so a current
    // copy's refusal has to stay exactly as terse as it was.
    const root = scratchRoot();

    installRealGuards(path.join(root, PLUGIN_TREE));
    datePluginTree(root, CURRENT);

    const { status, output } = runFallback(BYPASS, root);

    expect(status).toBe(BLOCKED);
    expect(output).toMatch(/Refused by /u);
    expect(output).not.toContain(CAVEAT);
    expect(output).not.toContain("Re-running the command confirms nothing");
  });
});

describe("one tree shadowing another", () => {
  it("names the guards whose second copy never runs", () => {
    // Two copies of a guard on one disk are two vintages of it more often than
    // not, and the one in force is whichever is FIRST — which says nothing
    // about which is newer. Until now the loser was silent by construction.
    const root = scratchRoot();

    installRealGuards(path.join(root, HOST_TREE));
    dateHostTree(root, CURRENT);
    installRealGuards(path.join(root, PLUGIN_TREE));
    datePluginTree(root, CURRENT);

    const { output } = runFallback(HARMLESS, root);

    expect(output).toContain("the shadowed copy never runs");
    for (const guard of GUARDS) {
      expect(output, guard).toContain(guard);
    }
  });
});

describe("a partially resolved guard set", () => {
  it("names every unresolved guard in the proactive notice", () => {
    const root = scratchRoot();

    installRealGuards(
      path.join(root, HOST_TREE),
      GUARDS.filter(guard => guard !== PARITY_SAFETY_NET)
    );
    dateHostTree(root, CURRENT);

    const { status, output } = runFallback(HARMLESS, root);

    expect(status).toBe(0);
    expect(output).toContain("unresolved guards");
    expect(output).toContain(PARITY_SAFETY_NET);
  });
});

describe("a checkout where nothing resolves", () => {
  it("fails rather than permitting", () => {
    expect(runFallback(HARMLESS, scratchRoot()).status).toBe(BLOCKED);
  });

  it("refuses the bypass for the same reason, not the guard's", () => {
    // "It only blocks the bad ones" would mean it evaluated them, which is
    // precisely what it could not do.
    const { status, output } = runFallback(BYPASS, scratchRoot());

    expect(status).toBe(BLOCKED);
    expect(output).toContain("checked by nothing at all");
  });

  it("does not look like a clean pass", () => {
    // An empty resolution and a clean pass returning the same thing is how a
    // control goes inert without anyone noticing.
    const empty = runFallback(HARMLESS, scratchRoot());
    const clean = runFallback(HARMLESS, REPO_ROOT);

    expect(empty.status).not.toBe(clean.status);
    expect(empty.output).not.toBe(clean.output);
  });
});
