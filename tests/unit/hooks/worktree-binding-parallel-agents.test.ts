/**
 * Parallel subagents in one session must not rebind each other.
 *
 * The binding guard keyed its state file on `session_id` alone, and every
 * subagent a session runs shares that id. Subagent B's first guarded call read
 * the binding subagent A recorded, so B's own worktree looked like a
 * displacement — B was refused, or an acknowledgement rebound the file and
 * A's next call was refused instead (CodySwannGT/lisa#4277). The payload's
 * `agent_id` is the discriminator: each subagent gets its own binding, the
 * main agent keeps the session-scoped one it always had.
 * @module tests/unit/hooks/worktree-binding-parallel-agents
 */
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALLOWED,
  bindTo,
  BLOCKED,
  buildFixture,
  runGuard,
  stateKey,
} from "./support/worktree-binding.js";

/** The state directory the guard writes under LISA_STATE_HOME. */
const BINDING_DIR = "worktree-binding";
const LEGACY_AGENT = "legacy-agent";

describe("the binding guard scopes bindings to the agent, not just the session", () => {
  it("lets two subagents sharing a session each bind their own worktree", () => {
    const fixture = buildFixture();

    expect(
      runGuard({ cwd: fixture.a, state: fixture.state, agent: "agent-a" })
        .status
    ).toBe(ALLOWED);
    expect(
      runGuard({ cwd: fixture.b, state: fixture.state, agent: "agent-b" })
        .status
    ).toBe(ALLOWED);
    expect(
      runGuard({ cwd: fixture.a, state: fixture.state, agent: "agent-a" })
        .status
    ).toBe(ALLOWED);
  });

  it("still refuses a displacement WITHIN one subagent's own binding", () => {
    const fixture = buildFixture();

    expect(
      runGuard({ cwd: fixture.a, state: fixture.state, agent: "agent-a" })
        .status
    ).toBe(ALLOWED);
    expect(
      runGuard({ cwd: fixture.b, state: fixture.state, agent: "agent-a" })
        .status
    ).toBe(BLOCKED);
  });

  it("does not let a subagent move the main agent's binding", () => {
    const fixture = buildFixture();

    bindTo(fixture, fixture.a);
    expect(
      runGuard({ cwd: fixture.b, state: fixture.state, agent: "agent-b" })
        .status
    ).toBe(ALLOWED);
    // The main agent (no agent_id) is still bound where it started.
    expect(runGuard({ cwd: fixture.a, state: fixture.state }).status).toBe(
      ALLOWED
    );
    // And its displacement rule is untouched.
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      BLOCKED
    );
  });

  it("keeps a session id ending in the separator apart from an agent id", () => {
    // The former composite filename could not distinguish session
    // "s--agent" + agent "c" from session "s" + agent
    // "agent--c" are different pairs and must not name the same state file.
    const fixture = buildFixture();

    expect(
      runGuard({
        cwd: fixture.a,
        state: fixture.state,
        session: "s--agent",
        agent: "c",
      }).status
    ).toBe(ALLOWED);
    // A different pair with the same old joined spelling must bind fresh.
    expect(
      runGuard({
        cwd: fixture.b,
        state: fixture.state,
        session: "s",
        agent: "agent--c",
      }).status
    ).toBe(ALLOWED);
    // And the first pair is still bound where it started.
    expect(
      runGuard({
        cwd: fixture.b,
        state: fixture.state,
        session: "s--agent",
        agent: "c",
      }).status
    ).toBe(BLOCKED);
  });

  it("keeps a main-session key out of the agent-scoped namespace", () => {
    // A main session named "s%2Da--c" must NOT
    // read the file the (session "s-a", agent "c") pair wrote — the raw
    // session id used to be able to smuggle an already-composed key.
    const fixture = buildFixture();

    expect(
      runGuard({
        cwd: fixture.a,
        state: fixture.state,
        session: "s-a",
        agent: "c",
      }).status
    ).toBe(ALLOWED);
    // The lookalike main session binds fresh rather than inheriting the
    // agent's binding.
    expect(
      runGuard({
        cwd: fixture.b,
        state: fixture.state,
        session: "s%2Da--c",
      }).status
    ).toBe(ALLOWED);
    // And the agent's binding is still bound where it started.
    expect(
      runGuard({
        cwd: fixture.b,
        state: fixture.state,
        session: "s-a",
        agent: "c",
      }).status
    ).toBe(BLOCKED);
  });

  it("keeps an agent id containing '*' filename-legal", () => {
    // NTFS forbids `*` in filenames. The state key must exclude it so writing
    // an otherwise valid identity cannot disable enforcement on Windows.
    const fixture = buildFixture();
    const starredAgent = "agent*7";

    const first = runGuard({
      cwd: fixture.a,
      state: fixture.state,
      session: "s",
      agent: starredAgent,
    });
    expect(first.status).toBe(ALLOWED);
    // The state file exists under the bounded, filename-safe tuple key.
    expect(
      existsSync(
        path.join(
          fixture.state,
          BINDING_DIR,
          `${stateKey("s", starredAgent)}.json`
        )
      )
    ).toBe(true);
    // The binding holds: the same pair in a different tree is refused.
    expect(
      runGuard({
        cwd: fixture.b,
        state: fixture.state,
        session: "s",
        agent: starredAgent,
      }).status
    ).toBe(BLOCKED);
  });

  it("requires intent before importing an older binding with no owner record", () => {
    // An unstamped legacy composite could belong to a v1 main session or a
    // different sanitized pair. Preserve it and require the existing explicit
    // acknowledgement instead of silently choosing an owner or a new baseline.
    const fixture = buildFixture();
    const legacyKey = "session-under-test--legacy-agent";
    mkdirSync(path.join(fixture.state, BINDING_DIR), {
      recursive: true,
    });
    writeFileSync(
      path.join(fixture.state, BINDING_DIR, `${legacyKey}.json`),
      `${JSON.stringify(
        {
          boundRoot: realpathSync(fixture.a),
          claimedRoot: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        null,
        2
      )}\n`
    );

    // Matching the old path alone does not establish who owns the file.
    expect(
      runGuard({ cwd: fixture.a, state: fixture.state, agent: LEGACY_AGENT })
        .status
    ).toBe(BLOCKED);
    expect(
      runGuard({
        cwd: fixture.a,
        state: fixture.state,
        agent: LEGACY_AGENT,
        input: {
          command: `echo 'lisa-worktree-binding: accept ${realpathSync(fixture.a)}'`,
        },
      }).status
    ).toBe(ALLOWED);
    expect(
      runGuard({ cwd: fixture.b, state: fixture.state, agent: LEGACY_AGENT })
        .status
    ).toBe(BLOCKED);
  });
});
