/** Native ownership controls for legacy binding migration (CodySwannGT/lisa#4311). */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALLOWED,
  BLOCKED,
  buildFixture,
  runGuard,
  stateKey,
  type Fixture,
} from "./support/worktree-binding.js";

const BINDING_DIR = "worktree-binding";
const ACCEPT = "lisa-worktree-binding: accept";
const OWNER_MESSAGE = /binding.*owner|binding.*belongs/iu;
const LONG_ID_LENGTH = 300;
const BINDING_VERSION = 4;

/**
 * Write an actual legacy state file without asserting its owner.
 * @param fixture - Owned repository and state directory
 * @param key - Historical filename stem
 * @param identity - Explicit owner tuple for the proven-ownership control
 * @returns Original file and bytes, for preservation assertions
 */
function legacy(fixture: Fixture, key: string, identity?: readonly string[]) {
  const file = path.join(fixture.state, BINDING_DIR, `${key}.json`);
  const text = JSON.stringify({
    boundRoot: realpathSync(fixture.a),
    claimedRoot: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...(identity === undefined
      ? {}
      : { bindingVersion: BINDING_VERSION, bindingIdentity: identity }),
  });
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return { file, text };
}

/**
 * Feed the existing literal acknowledgement protocol to the real guard.
 * @param fixture - Owned native fixture
 * @param session - Session selecting the observed root
 * @param agent - Agent within that session
 * @param cwd - Observed checkout to acknowledge
 * @returns Native guard verdict
 */
function accept(fixture: Fixture, session: string, agent: string, cwd: string) {
  return runGuard({
    cwd,
    state: fixture.state,
    session,
    agent,
    input: { command: `echo '${ACCEPT} ${realpathSync(cwd)}'` },
  });
}

describe("legacy bindings require proven ownership", () => {
  it("does not import or overwrite a v1 main session through an agent key", () => {
    const fixture = buildFixture();
    const saved = legacy(fixture, "s--a");
    const call = { state: fixture.state, session: "s", agent: "a" };

    const unknown = runGuard({ ...call, cwd: fixture.b });
    expect(unknown.status).toBe(BLOCKED);
    expect(unknown.stderr).toMatch(OWNER_MESSAGE);
    expect(readFileSync(saved.file, "utf8")).toBe(saved.text);

    expect(accept(fixture, "s", "a", fixture.b).status).toBe(ALLOWED);
    expect(readFileSync(saved.file, "utf8")).toBe(saved.text);
    expect(runGuard({ ...call, cwd: fixture.b }).status).toBe(ALLOWED);
    expect(runGuard({ ...call, cwd: fixture.a }).status).toBe(BLOCKED);
    // The legacy stranger's initial root must not become this agent's recovery root.
    expect(
      runGuard({
        ...call,
        cwd: fixture.b,
        input: {
          command: `echo '${ACCEPT} ${realpathSync(fixture.a)}'`,
        },
      }).status
    ).toBe(BLOCKED);
  });

  it("keeps the two possible owners of a sanitized v2 file independent", () => {
    const fixture = buildFixture();
    const saved = legacy(fixture, "s_1--a");
    for (const session of ["s:1", "s_1"]) {
      const unknown = runGuard({
        cwd: fixture.b,
        state: fixture.state,
        session,
        agent: "a",
      });
      expect(unknown.status).toBe(BLOCKED);
      expect(unknown.stderr).toMatch(OWNER_MESSAGE);
    }
    expect(accept(fixture, "s:1", "a", fixture.a).status).toBe(ALLOWED);
    expect(accept(fixture, "s_1", "a", fixture.b).status).toBe(ALLOWED);
    expect(readFileSync(saved.file, "utf8")).toBe(saved.text);
    expect(
      runGuard({
        cwd: fixture.a,
        state: fixture.state,
        session: "s:1",
        agent: "a",
      }).status
    ).toBe(ALLOWED);
    expect(
      runGuard({
        cwd: fixture.b,
        state: fixture.state,
        session: "s:1",
        agent: "a",
      }).status
    ).toBe(BLOCKED);
    expect(
      runGuard({
        cwd: fixture.b,
        state: fixture.state,
        session: "s_1",
        agent: "a",
      }).status
    ).toBe(ALLOWED);
  });

  it("does not turn an ambiguous file into a baseline at SessionStart", () => {
    const fixture = buildFixture();
    const saved = legacy(fixture, "s--a");
    const call = {
      cwd: fixture.b,
      state: fixture.state,
      session: "s",
      agent: "a",
    };
    expect(
      runGuard({
        ...call,
        event: "SessionStart",
        runtime: { CLAUDECODE: "1", AI_AGENT: "claude-code_0-0-1_agent" },
      }).status
    ).toBe(ALLOWED);
    expect(readFileSync(saved.file, "utf8")).toBe(saved.text);
    const unknown = runGuard(call);
    expect(unknown.status).toBe(BLOCKED);
    expect(unknown.stderr).toMatch(OWNER_MESSAGE);
  });

  it("preserves a legacy binding whose owner is explicitly proven", () => {
    const fixture = buildFixture();
    legacy(fixture, "s--a", ["s", "a"]);
    const call = { state: fixture.state, session: "s", agent: "a" };
    expect(runGuard({ ...call, cwd: fixture.a }).status).toBe(ALLOWED);
    expect(
      runGuard({ ...call, cwd: fixture.b, event: "SessionStart" }).status
    ).toBe(ALLOWED);
    const displaced = runGuard({ ...call, cwd: fixture.b });
    expect(displaced.status).toBe(BLOCKED);
    expect(displaced.stderr).toContain("changed underneath");
  });

  it("refuses a current state file identifying another owner without rewriting it", () => {
    const fixture = buildFixture();
    const call = { state: fixture.state, session: "s", agent: "a" };
    expect(runGuard({ ...call, cwd: fixture.a }).status).toBe(ALLOWED);
    const file = path.join(
      fixture.state,
      BINDING_DIR,
      `${stateKey("s", "a")}.json`
    );
    const text = JSON.stringify({
      ...JSON.parse(readFileSync(file, "utf8")),
      bindingVersion: BINDING_VERSION,
      bindingIdentity: ["other-session", "other-agent"],
    });
    writeFileSync(file, text);
    const foreign = runGuard({ ...call, cwd: fixture.a });
    expect(foreign.status).toBe(BLOCKED);
    expect(foreign.stderr).toMatch(OWNER_MESSAGE);
    expect(accept(fixture, "s", "a", fixture.a).status).toBe(BLOCKED);
    expect(readFileSync(file, "utf8")).toBe(text);
  });

  it("keeps a fresh main session separate from the similarly spelled agent pair", () => {
    const fixture = buildFixture();
    expect(
      runGuard({
        cwd: fixture.a,
        state: fixture.state,
        session: "s",
        agent: "a",
      }).status
    ).toBe(ALLOWED);
    expect(
      runGuard({ cwd: fixture.b, state: fixture.state, session: "s--a" }).status
    ).toBe(ALLOWED);
    expect(
      runGuard({
        cwd: fixture.a,
        state: fixture.state,
        session: "s",
        agent: "a",
      }).status
    ).toBe(ALLOWED);
  });

  it("keeps case-distinct sessions independent on every filesystem", () => {
    const fixture = buildFixture();
    expect(
      runGuard({ cwd: fixture.a, state: fixture.state, session: "Owner" })
        .status
    ).toBe(ALLOWED);
    expect(
      runGuard({ cwd: fixture.b, state: fixture.state, session: "owner" })
        .status
    ).toBe(ALLOWED);
    expect(
      runGuard({ cwd: fixture.a, state: fixture.state, session: "Owner" })
        .status
    ).toBe(ALLOWED);
    expect(
      runGuard({ cwd: fixture.b, state: fixture.state, session: "Owner" })
        .status
    ).toBe(BLOCKED);
  });

  it("retains enforcement for an identity longer than a filename component", () => {
    const fixture = buildFixture();
    const session = "s".repeat(LONG_ID_LENGTH);
    expect(
      runGuard({ cwd: fixture.a, state: fixture.state, session }).status
    ).toBe(ALLOWED);
    expect(
      runGuard({ cwd: fixture.b, state: fixture.state, session }).status
    ).toBe(BLOCKED);
  });
});
