/**
 * The guard depends on a runtime it does not ship, and says when that lapses.
 *
 * CodySwannGT/lisa#3944. `worktree-binding-guard.mjs` deliberately does not
 * refuse an INLINE redirect into a sibling worktree — `cd B && git …`,
 * `git -C B …` — because the runtime's own worktree isolation already does,
 * and two controls covering one command is how they drift into disagreeing.
 *
 * That reason is a dependency on behaviour Lisa cannot test: the runtime
 * adjudicates inside a live session and exposes no entry point that takes one
 * envelope and returns a verdict. So the claim cannot be made red by writing a
 * test, and a claim that cannot go red goes stale silently instead — measured
 * happening the same evening, in CodySwannGT/lisa#3942, where one version
 * refused what another permitted ten minors apart with nobody able to tell
 * which was running.
 *
 * What CAN be measured is whether the runtime is still the one the claim was
 * checked against. These cases hold that measurement to the shape that makes it
 * worth having: it fires on a move, and it is SILENT otherwise, because a
 * notice that fires always is noise and noise gets switched off.
 * @module tests/unit/hooks/worktree-binding-runtime-assumption
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ALLOWED, buildFixture, runGuard } from "./support/worktree-binding.js";

/** The event the notice rides on: the guard's first look at a session. */
const START = "SessionStart";

/** A version no build will ever carry, so a match cannot be coincidence. */
const MOVED = "9.9.9";

/**
 * The version the inline-redirect claim was last verified at.
 *
 * Read out of the guard rather than copied here. Copying it would make the
 * control case below assert that the guard is silent at a version this file
 * names — which stays true after someone moves the pin and stops being about
 * the pin at all. Read, it keeps asserting that the guard is silent at the
 * version the guard itself considers verified.
 */
const VERIFIED = (() => {
  const source = readFileSync(
    path.resolve("plugins/src/base/hooks/worktree-binding-guard.mjs"),
    "utf8"
  );
  const pinned = /const VERIFIED_RUNTIME_VERSION = "([^"]+)"/u.exec(
    source
  )?.[1];
  if (!pinned) throw new Error("the guard no longer pins a verified version");
  return pinned;
})();

/**
 * The runtime variables a Claude Code session of a given version sets.
 * @param version - The version to report, or "" for a runtime that will not say
 * @returns Environment for {@link runGuard}
 */
function claudeCode(version: string): Record<string, string> {
  const tag = version.replaceAll(".", "-");
  return version
    ? { CLAUDECODE: "1", AI_AGENT: `claude-code_${tag}_agent` }
    : { CLAUDECODE: "1" };
}

/**
 * Start a session under a runtime and return what the guard told the agent.
 * @param runtime - Runtime variables for the session
 * @returns The `additionalContext` emitted, or "" when nothing was
 */
function startedUnder(runtime: Record<string, string>): string {
  return contextFrom(buildFixture(), runtime);
}

/**
 * Start a session in an existing fixture and read the notice out of stdout.
 * @param fixture - The repository under test
 * @param runtime - Runtime variables for the session
 * @returns The `additionalContext` emitted, or "" when nothing was
 */
function contextFrom(
  fixture: ReturnType<typeof buildFixture>,
  runtime: Record<string, string>
): string {
  const result = runGuard({
    cwd: fixture.a,
    state: fixture.state,
    event: START,
    runtime,
  });
  const stdout = result.stdout.trim();
  expect(result.status).toBe(ALLOWED);
  if (!stdout) return "";
  return JSON.parse(stdout).hookSpecificOutput.additionalContext;
}

describe("the runtime the inline-redirect gap depends on", () => {
  it("reports the divergence when the runtime moves off the verified one", () => {
    // THE BITE. Before this, a runtime that stopped refusing the inline forms
    // left two cells uncovered and nothing said so — not this suite either,
    // which correctly asserts that the guard does NOT cover them. The gap-note
    // read as a decision rather than as an exposure.
    const notice = startedUnder(claudeCode(MOVED));

    expect(notice).toContain(MOVED);
    expect(notice).toContain(VERIFIED);
    expect(notice).toContain("CodySwannGT/lisa#3944");
    expect(notice).toContain("git -C");
  });

  it("says nothing when the runtime is the verified one", () => {
    // The rejection control, and the reason the case above is worth having: a
    // notice that fires on every session is noise, and the operator's remedy
    // for noise is to switch the guard off — which costs the four cells it
    // does cover to buy nothing on the two it does not.
    expect(startedUnder(claudeCode(VERIFIED))).toBe("");
  });

  it("reports once, not on every start of the same session", () => {
    // A resume fires SessionStart again for the same session id. Repeating the
    // notice there would train a reader to skip it, which is the same switched
    // -off outcome by a slower route.
    const fixture = buildFixture();
    const runtime = claudeCode(MOVED);

    expect(contextFrom(fixture, runtime)).toContain(MOVED);
    expect(contextFrom(fixture, runtime)).toBe("");
  });

  it("reports again when the runtime moves a second time", () => {
    // Why the version is recorded rather than a "notified" flag. A session
    // resumed onto a THIRD build is a fresh unverified state, and a flag would
    // have spent its one report on the second one.
    const fixture = buildFixture();

    expect(contextFrom(fixture, claudeCode(MOVED))).toContain(MOVED);
    expect(contextFrom(fixture, claudeCode("8.8.8"))).toContain("8.8.8");
  });

  it("reports a runtime that will not say which version it is", () => {
    // An unreadable version is NOT a match. Treating it as one would make the
    // assumption survive exactly the change most likely to break it — a
    // release that renames or drops the variable this reads — which is the
    // silent expiry this ticket exists to end.
    const notice = startedUnder(claudeCode(""));

    expect(notice).toContain("could not be read");
    expect(notice).toContain(VERIFIED);
  });

  it("reads the version from the launch path when the tag is absent", () => {
    // Two variables carry it and either could be the one a future release
    // keeps. Silence here is the assertion: the fallback has to PARSE the
    // verified version out of the path to stay quiet, because an unreadable
    // version reports.
    expect(
      startedUnder({
        CLAUDECODE: "1",
        CLAUDE_CODE_EXECPATH: `/Users/x/.local/share/claude/versions/${VERIFIED}`,
      })
    ).toBe("");
  });

  it("says nothing on a runtime that has no such isolation to depend on", () => {
    // Codex, Cursor and Copilot ship this guard too, and the assumption is
    // about a control none of them has. A notice on every session of every
    // harness is the noise case again, arriving from the other direction.
    expect(startedUnder({ AI_AGENT: `claude-code_${MOVED}_agent` })).toBe("");
  });

  it("never turns a moved runtime into a refusal", () => {
    // The dependency is a REPORTING gap, not a live displacement. Blocking a
    // session over a version number would be a wall where an observation
    // belongs, and the wall is what gets the whole guard switched off.
    const fixture = buildFixture();
    contextFrom(fixture, claudeCode(MOVED));

    const result = runGuard({
      cwd: fixture.a,
      state: fixture.state,
      runtime: claudeCode(MOVED),
      input: { command: "git status" },
    });

    expect(result.status).toBe(ALLOWED);
    expect(result.stdout).toBe("");
  });
});
