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
import { describe, expect, it } from "vitest";

import {
  ALLOWED,
  bindTo,
  BLOCKED,
  buildFixture,
  runGuard,
} from "./support/worktree-binding.js";

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
    // The composite key is a FILENAME, so the `--` joiner must be
    // unambiguous: session "s--agent" with no agent_id names the same file as
    // session "s" with agent "agent" unless each half is escaped first.
    const fixture = buildFixture();

    expect(
      runGuard({
        cwd: fixture.a,
        state: fixture.state,
        session: "s--agent",
        agent: "c",
      }).status
    ).toBe(ALLOWED);
    // A different (session, agent) pair that would spell the same key if the
    // parts were not escaped: it must bind fresh, not displace.
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
});
