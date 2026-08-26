/**
 * How often the proactive staleness notice is allowed to speak.
 *
 * The first version of this feature printed the notice whenever a resolved tree
 * was behind, on the reasoning that a current checkout would stay silent.
 * Measured, that reasoning is wrong twice over:
 *
 *   - `main` cut 80 releases in 24 hours, median gap 10 minutes. A checkout is
 *     behind the newest Lisa on the disk within minutes of being cut, through
 *     nothing anyone did wrong.
 *   - Across the 27 host checkouts in this fleet, 12 resolve guards at all, and
 *     all 12 are behind or undateable. None is current. Eight carry no apply
 *     receipt; four are behind by a whole major.
 *
 * So no distance threshold rescues it — the strictest version predicate is
 * permanently true across the fleet. The noise is the REPETITION: a banner on
 * every tool call for a whole session is one people learn to skip past, and a
 * guard whose output gets skipped past is a guard that stops being read.
 *
 * The rate limit therefore lands on repetition, and the distance threshold
 * stays at zero. These cases pin both halves of that split: the notice speaks
 * once per session, and every refusal keeps its full attribution regardless.
 * @module tests/unit/hooks/enforcement-fallback-notice-rate
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  statSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BEHIND,
  BLOCKED,
  CURRENT,
  HOST_TREE,
  PLUGIN_TREE,
  bash,
  cleanupScratchRoots,
  dateHostTree,
  datePluginTree,
  installRealGuards,
  runFallback,
  scratchRoot,
  scratchTmpdir,
} from "../../helpers/enforcement-fallback-fixtures.js";

afterEach(cleanupScratchRoots);

/** A session id shaped like the ones Claude Code sends. */
const SESSION = "11111111-2222-3333-4444-555555555555";

/** A second, unrelated session. */
const OTHER_SESSION = "99999999-8888-7777-6666-555555555555";

/** The line that only appears when the proactive notice speaks. */
const NOTICE = "not from npm";

/**
 * A checkout whose host tree is behind and whose plugin tree is current — the
 * fleet's normal state, where the notice has something to say on every call.
 * @returns The project root.
 */
function staleRoot(): string {
  const root = scratchRoot();

  installRealGuards(path.join(root, HOST_TREE));
  dateHostTree(root, BEHIND);
  installRealGuards(path.join(root, PLUGIN_TREE));
  datePluginTree(root, CURRENT);
  return root;
}

describe("the proactive notice, across one session", () => {
  it("speaks on the first call and stays quiet after it", () => {
    // The whole point. Before the rate limit this printed five times out of
    // five, and would have printed on every tool call for the whole session.
    const root = staleRoot();
    const tmp = scratchTmpdir();
    const spoke = [1, 2, 3, 4, 5].map(_ =>
      runFallback(bash("ls -la", SESSION), root, tmp).output.includes(NOTICE)
    );

    expect(spoke).toEqual([true, false, false, false, false]);
  });

  it("still permits on every one of those calls", () => {
    const root = staleRoot();
    const tmp = scratchTmpdir();
    const statuses = [1, 2, 3].map(
      _ => runFallback(bash("ls -la", SESSION), root, tmp).status
    );

    expect(statuses).toEqual([0, 0, 0]);
  });

  it("speaks again for a different session", () => {
    // Per session, not per machine: a new session has a new operator's
    // attention, and has not been told.
    const root = staleRoot();
    const tmp = scratchTmpdir();

    runFallback(bash("ls -la", SESSION), root, tmp);

    expect(
      runFallback(bash("ls -la", OTHER_SESSION), root, tmp).output
    ).toContain(NOTICE);
  });

  it("stores its marker in a private per-user directory", () => {
    const root = staleRoot();
    const tmp = scratchTmpdir();

    runFallback(bash("ls -la", SESSION), root, tmp);

    const stateDir = path.join(
      tmp,
      `lisa-enforcement-notice-${process.getuid()}`
    );
    expect(statSync(stateDir).mode & 0o077).toBe(0);
    expect(lstatSync(path.join(stateDir, SESSION)).isFile()).toBe(true);
  });

  it("does not trust a private leaf below a non-sticky shared temp base", () => {
    const root = staleRoot();
    const tmp = scratchTmpdir();
    chmodSync(tmp, 0o777);

    const spoke = [1, 2].map(_ =>
      runFallback(bash("ls -la", SESSION), root, tmp).output.includes(NOTICE)
    );

    expect(spoke).toEqual([true, true]);
    expect(
      existsSync(path.join(tmp, `lisa-enforcement-notice-${process.getuid()}`))
    ).toBe(false);
  });

  it("does not follow a pre-existing marker symlink", () => {
    const root = staleRoot();
    const tmp = scratchTmpdir();
    const target = path.join(tmp, "must-not-be-created");

    for (const stateDir of [
      path.join(tmp, "lisa-enforcement-notice"),
      path.join(tmp, `lisa-enforcement-notice-${process.getuid()}`),
    ]) {
      mkdirSync(stateDir, { recursive: true });
      symlinkSync(target, path.join(stateDir, SESSION));
    }

    const { output } = runFallback(bash("ls -la", SESSION), root, tmp);

    expect(output).toContain(NOTICE);
    expect(existsSync(target)).toBe(false);
  });
});

describe("a payload with no session id", () => {
  it("degrades to speaking every time, not to silence", () => {
    // Fail-noisy. A rate limit that cannot identify the session must not
    // conclude it has already spoken — that is the rate limit reintroducing
    // the silence it was added to preserve.
    const root = staleRoot();
    const tmp = scratchTmpdir();
    const spoke = [1, 2, 3].map(_ =>
      runFallback(bash("ls -la"), root, tmp).output.includes(NOTICE)
    );

    expect(spoke).toEqual([true, true, true]);
  });
});

describe("a refusal after the notice has been spent", () => {
  it("still names the copy that produced it and its vintage", () => {
    // The half that pays, and the half the rate limit must not touch:
    // attribution costs nothing because it only prints when something has
    // already been blocked.
    const root = staleRoot();
    const tmp = scratchTmpdir();

    runFallback(bash("ls -la", SESSION), root, tmp);

    const { status, output } = runFallback(
      bash("rm -rf /", SESSION),
      root,
      tmp
    );

    expect(status).toBe(BLOCKED);
    expect(output).not.toContain(NOTICE);
    expect(output).toContain(
      `Refused by ${path.join(root, HOST_TREE, "parity-safety-net.sh")}`
    );
    expect(output).toContain(`lisa ${BEHIND}, STALE — ${CURRENT}`);
  });
});
