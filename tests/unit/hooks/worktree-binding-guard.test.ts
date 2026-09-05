/**
 * Tests for the worktree-binding guard.
 *
 * The defect (CodySwannGT/lisa#3864) is three subsystems disagreeing about
 * which worktree a session is in while the one reporting success is the one
 * that is wrong. `EnterWorktree` said the session had moved, Bash kept running
 * in the previous worktree, and Edit refused the destination by name. A
 * refusal teaches you something; a false success is a confirmation, and it is
 * acted on.
 *
 * WHY THE REFUSING CASES ARE THE POINT. A suite that only proves the guard
 * stays quiet when everything agrees passes today against a guard that does
 * nothing at all — the state under test is the one where the harness lies, and
 * it has to be constructed deliberately. Every accepting case below is
 * therefore paired with the refusal it would have been had one fact changed,
 * and the acknowledgement cases exist so that "the block can be cleared" and
 * "the block clears itself" are told apart.
 * @module tests/unit/hooks/worktree-binding-guard
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALLOWED,
  BLOCKED,
  bindTo,
  buildFixture,
  runGuard,
  runRaw,
  SESSION,
  trackTempDir,
} from "./support/worktree-binding.js";

describe("worktree-binding-guard", () => {
  it("records the binding on the first guarded call and allows it", () => {
    const fixture = buildFixture();
    const result = runGuard({ cwd: fixture.a, state: fixture.state });
    expect(result.status).toBe(ALLOWED);
    const recorded = JSON.parse(
      readFileSync(
        path.join(fixture.state, "worktree-binding", `${SESSION}.json`),
        "utf8"
      )
    );
    expect(recorded.boundRoot).toContain("wt-a");
  });

  it("allows a later call from the same worktree", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(runGuard({ cwd: fixture.a, state: fixture.state }).status).toBe(
      ALLOWED
    );
  });

  it("refuses when the session's worktree moved underneath it", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const result = runGuard({ cwd: fixture.b, state: fixture.state });
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain("wt-a");
    expect(result.stderr).toContain("wt-b");
  });

  it("keeps refusing a blind retry of the displaced call", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    runGuard({ cwd: fixture.b, state: fixture.state });
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      BLOCKED
    );
  });

  it("refuses the first action after EnterWorktree reports a switch that did not take effect", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(
      runGuard({
        cwd: fixture.a,
        state: fixture.state,
        tool: "EnterWorktree",
        input: { path: fixture.b },
      }).status
    ).toBe(ALLOWED);

    const result = runGuard({ cwd: fixture.a, state: fixture.state });
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain("EnterWorktree reported success");
    expect(result.stderr).toContain("wt-b");
    expect(result.stderr).toContain("wt-a");
  });

  it("refuses a Write taken on the strength of that false success", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    runGuard({
      cwd: fixture.a,
      state: fixture.state,
      tool: "EnterWorktree",
      input: { path: fixture.b },
    });
    const result = runGuard({
      cwd: fixture.a,
      state: fixture.state,
      tool: "Write",
      input: { file_path: path.join(fixture.b, "new.txt"), content: "x" },
    });
    expect(result.status).toBe(BLOCKED);
  });

  it("allows the next call when the switch really did take effect", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    runGuard({
      cwd: fixture.a,
      state: fixture.state,
      tool: "EnterWorktree",
      input: { path: fixture.b },
    });
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      ALLOWED
    );
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      ALLOWED
    );
  });

  it("rebinds on an acknowledgement naming the worktree the session is in", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      BLOCKED
    );
    const accept = runGuard({
      cwd: fixture.b,
      state: fixture.state,
      input: { command: `echo 'lisa-worktree-binding: accept ${fixture.b}'` },
    });
    expect(accept.status).toBe(ALLOWED);
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      ALLOWED
    );
  });

  it("refuses an acknowledgement naming a worktree the session is not in", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const accept = runGuard({
      cwd: fixture.b,
      state: fixture.state,
      input: { command: `echo 'lisa-worktree-binding: accept ${fixture.a}'` },
    });
    expect(accept.status).toBe(BLOCKED);
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      BLOCKED
    );
  });

  it("keeps one session's displacement out of another session's binding", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(
      runGuard({ cwd: fixture.b, state: fixture.state, session: "other" })
        .status
    ).toBe(ALLOWED);
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      BLOCKED
    );
  });

  it("ignores tools that cannot act on a worktree", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(
      runGuard({ cwd: fixture.b, state: fixture.state, tool: "Read" }).status
    ).toBe(ALLOWED);
  });

  it("fails open and says so when the payload carries no cwd", () => {
    const fixture = buildFixture();
    const result = runRaw(
      JSON.stringify({ session_id: SESSION, tool_name: "Bash" }),
      fixture.a,
      fixture.state
    );
    expect(result.status).toBe(ALLOWED);
    expect(result.stderr).toContain("NOT enforced");
  });

  it("fails open and says so when the payload is not JSON", () => {
    const fixture = buildFixture();
    const result = runRaw("not json", fixture.a, fixture.state);
    expect(result.status).toBe(ALLOWED);
    expect(result.stderr).toContain("NOT enforced");
  });

  it("stays quiet outside a git repository", () => {
    const fixture = buildFixture();
    const outside = mkdtempSync(path.join(tmpdir(), "lisa-wtb-out-"));
    trackTempDir(outside);
    expect(runGuard({ cwd: outside, state: fixture.state }).status).toBe(
      ALLOWED
    );
  });
});
