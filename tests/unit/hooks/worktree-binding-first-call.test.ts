/**
 * The binding guard must CHECK its first guarded call, not merely record it.
 *
 * ## What was broken
 *
 * The first guarded call established the baseline instead of testing one: no
 * state for the session meant "write down wherever you are and allow". So a
 * session already sitting in a foreign worktree when it first acted bound to
 * that tree and was never refused — and every later call was then checked
 * faithfully against the wrong baseline, defending the session INTO the wrong
 * worktree rather than out of it (CodySwannGT/lisa#3955).
 *
 * That is trust-on-first-use, and TOFU is only as safe as the first use. Here
 * the first use is assigned by the harness, unasked (#3864), so the one moment
 * the guard trusted was the moment the session had least control over.
 *
 * ## Why an earlier observation separates what a cleverer check cannot
 *
 * At the first guarded call, "I was displaced before I acted" and "I
 * legitimately started here" present identically: one session id, one observed
 * root, no prior state. No comparison can separate them, because the
 * information is not in the hook's inputs at that instant.
 *
 * At SESSION START it is. The displacement mechanism actually observed is a
 * PEER's `EnterWorktree` moving this session (#3712), which happens during the
 * session — after it started. So a baseline taken at session start was recorded
 * before the event that moves it, and the first guarded call becomes an
 * ordinary comparison against a baseline that already existed. It reaches the
 * same refusal a later displacement produces, because by then it IS one.
 *
 * ## What this does NOT achieve, stated rather than implied
 *
 * #3955's third scenario asks for a baseline that comes from the ASSIGNER
 * rather than from observation. That is not built here and cannot be by Lisa:
 * Lisa does not own `EnterWorktree` (#3864), and nothing the harness writes
 * names a session's assigned worktree in a form a hook can read. This baseline
 * is still an observation — an earlier one. The window it closes is "any moment
 * between session start and the first guarded call"; the window it leaves open
 * is a session launched already displaced, where session start observes the
 * foreign tree and TOFU still applies.
 * @module tests/unit/hooks/worktree-binding-first-call
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../support/git-executable.js";

import {
  ALLOWED,
  BLOCKED,
  buildFixture,
  runGuard,
  SESSION,
  type Fixture,
} from "./support/worktree-binding.js";

const GUARD = path.resolve("plugins/src/base/hooks/worktree-binding-guard.mjs");

/**
 * Fire the SessionStart event at the guard, the way the harness would.
 *
 * SessionStart carries no tool, so the payload names the event rather than a
 * tool call. A guard that keyed only off `tool_name` would see nothing here,
 * which is exactly what it used to do.
 * @param cwd - The directory the session starts in
 * @param state - Guard state home
 * @returns Exit status and everything the guard printed
 */
function sessionStart(cwd: string, state: string) {
  return boundedSpawnSync({
    label: "worktree-binding-guard",
    command: process.execPath,
    args: [GUARD],
    cwd,
    env: { ...cleanGitEnv(), LISA_STATE_HOME: state },
    input: JSON.stringify({
      session_id: SESSION,
      cwd,
      hook_event_name: "SessionStart",
      source: "startup",
    }),
  });
}

/**
 * The baseline the guard has recorded for the session under test.
 * @param fixture - The repository under test
 * @returns The recorded bound root, or null when nothing is recorded
 */
function recordedBaseline(fixture: Fixture): string | null {
  try {
    const file = path.join(
      fixture.state,
      "worktree-binding",
      `${SESSION}.json`
    );
    return JSON.parse(readFileSync(file, "utf8")).boundRoot ?? null;
  } catch {
    return null;
  }
}

describe("the binding guard checks its first guarded call", () => {
  it("BLOCKS a session whose first guarded call is in a tree it did not start in", () => {
    // The defect, and the row that fails against the guard as it was: session
    // starts in A, a peer's EnterWorktree moves it to B, and the FIRST thing it
    // does is already in the wrong tree.
    const fixture = buildFixture();
    expect(sessionStart(fixture.a, fixture.state).status).toBe(ALLOWED);

    const verdict = runGuard({ cwd: fixture.b, state: fixture.state });

    expect(verdict.status).toBe(BLOCKED);
    expect(verdict.stderr).toContain(fixture.a);
    expect(verdict.stderr).toContain(fixture.b);
  });

  it("names the displacement in the SAME words a later displacement uses", () => {
    // #3955 asks for this explicitly. Two refusal texts for one condition is
    // how an operator learns to read one of them as less serious.
    const fixture = buildFixture();
    expect(sessionStart(fixture.a, fixture.state).status).toBe(ALLOWED);
    const first = runGuard({ cwd: fixture.b, state: fixture.state });

    const later = buildFixture();
    expect(sessionStart(later.a, later.state).status).toBe(ALLOWED);
    expect(runGuard({ cwd: later.a, state: later.state }).status).toBe(ALLOWED);
    const afterwards = runGuard({ cwd: later.b, state: later.state });

    // replaceAll, not replace: each path appears twice — once in the
    // comparison and once in the acceptance line — and normalising only the
    // first occurrence makes two identical texts look different.
    expect(
      first.stderr.replaceAll(fixture.a, "A").replaceAll(fixture.b, "B")
    ).toBe(afterwards.stderr.replaceAll(later.a, "A").replaceAll(later.b, "B"));
  });

  it("PERMITS an ordinary first call and records the tree it started in", () => {
    // The regression control. A fix that refuses ordinary first calls is worse
    // than the defect, because a guard that refuses everyone gets switched off.
    const fixture = buildFixture();
    expect(sessionStart(fixture.a, fixture.state).status).toBe(ALLOWED);

    expect(runGuard({ cwd: fixture.a, state: fixture.state }).status).toBe(
      ALLOWED
    );
    expect(recordedBaseline(fixture)).toBe(fixture.a);
  });

  it("PERMITS a first call when SessionStart never ran, rather than walling it", () => {
    // The other rejection direction. SessionStart does not fire everywhere —
    // an older install, a runtime with no plugin, a harness that skips it — and
    // treating "no baseline" as "refuse" would turn a floor into a wall for
    // every session on those surfaces. Absence of a baseline is absence of
    // evidence, so this falls back to recording one, exactly as before.
    const fixture = buildFixture();

    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      ALLOWED
    );
    expect(recordedBaseline(fixture)).toBe(fixture.b);
  });

  it("does not overwrite a baseline SessionStart already recorded", () => {
    // A second SessionStart — a resumed session, a reconnect — must not rebind.
    // If it did, the displaced case could be laundered into a fresh baseline by
    // anything that fires the event twice.
    const fixture = buildFixture();
    expect(sessionStart(fixture.a, fixture.state).status).toBe(ALLOWED);
    expect(sessionStart(fixture.b, fixture.state).status).toBe(ALLOWED);

    expect(recordedBaseline(fixture)).toBe(fixture.a);
  });

  it("records nothing for a session that starts outside any worktree", () => {
    // Not every session starts in a worktree, and inventing a baseline for one
    // that does not would make the guard answer a question nobody asked.
    const fixture = buildFixture();

    expect(sessionStart(path.dirname(fixture.main), fixture.state).status).toBe(
      ALLOWED
    );

    expect(recordedBaseline(fixture)).toBeNull();
  });
});
