/** Native repository identity and deliberate binding recovery controls (#4301). */
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ALLOWED,
  BLOCKED,
  bindTo,
  buildFixture,
  git,
  QUIET,
  runGuard,
  SESSION,
  stateKey,
  type Fixture,
} from "./support/worktree-binding.js";

const ACCEPT = "lisa-worktree-binding: accept";

/**
 * Read the binding the real guard recorded.
 * @param fixture - Owned native fixture
 * @returns Persisted root
 */
const boundRoot = (fixture: Fixture): string =>
  JSON.parse(
    readFileSync(
      path.join(fixture.state, "worktree-binding", `${stateKey(SESSION)}.json`),
      "utf8"
    )
  ).boundRoot;

/**
 * A fresh repository that is not a linked worktree of the fixture.
 * @param fixture - Owned native fixture
 * @param nested - Whether to place the independent root inside a linked tree
 * @returns Independent repository root
 */
const independentRepo = (fixture: Fixture, nested = false): string => {
  const root = path.join(
    nested ? fixture.a : path.dirname(fixture.main),
    "independent"
  );
  git(fixture.main, ["init", QUIET, root]);
  return root;
};

/**
 * Execute only the guard; the proposed script is never run by this helper.
 * @param fixture - Owned native fixture
 * @param target - Root referenced by script data
 * @returns Guard verdict
 */
const reach = (fixture: Fixture, target: string) => {
  const script = path.join(fixture.a, "visit.sh");
  writeFileSync(script, `ls "${target}"\n`);
  return runGuard({
    cwd: fixture.a,
    state: fixture.state,
    input: { command: `bash "${script}"` },
  });
};

/**
 * The exact acknowledgement the refusal tells the operator to run.
 * @param fixture - Owned native fixture
 * @returns Printed command
 */
const offeredAcknowledgement = (fixture: Fixture): string => {
  const result = reach(fixture, fixture.b);
  const line = result.stderr
    .split("\n")
    .find(value => value.trim().startsWith("echo "));
  expect(result.status).toBe(BLOCKED);
  if (!line) throw new Error("The refusal did not offer an acknowledgement");
  return line.trim();
};

describe("worktree binding uses repository identity", () => {
  it.each([false, true])(
    "allows a script naming an independent repo (nested=%s)",
    nested => {
      const fixture = buildFixture();
      bindTo(fixture, fixture.a);
      expect(reach(fixture, independentRepo(fixture, nested)).status).toBe(
        ALLOWED
      );
      expect(boundRoot(fixture)).toBe(realpathSync(fixture.a));
    }
  );

  it.each([false, true])(
    "allows an independent cwd without changing the binding (nested=%s)",
    nested => {
      const fixture = buildFixture();
      bindTo(fixture, fixture.a);
      const cwd = independentRepo(fixture, nested);
      expect(runGuard({ cwd, state: fixture.state }).status).toBe(ALLOWED);
      expect(boundRoot(fixture)).toBe(realpathSync(fixture.a));
      expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
        BLOCKED
      );
    }
  );

  it("continues refusing a script that names a linked worktree", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(reach(fixture, fixture.b).status).toBe(BLOCKED);
    expect(boundRoot(fixture)).toBe(realpathSync(fixture.a));
  });

  it("does not record an independent repository's EnterWorktree claim", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    runGuard({
      cwd: independentRepo(fixture),
      state: fixture.state,
      tool: "EnterWorktree",
      event: "PostToolUse",
      input: { path: fixture.b },
    });
    expect(runGuard({ cwd: fixture.a, state: fixture.state }).status).toBe(
      ALLOWED
    );
    expect(boundRoot(fixture)).toBe(realpathSync(fixture.a));
  });
});

describe("worktree binding acknowledgement recovery", () => {
  it("accepts the offered target and still refuses calls until the session moves", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const command = offeredAcknowledgement(fixture);
    expect(
      runGuard({ cwd: fixture.a, state: fixture.state, input: { command } })
        .status
    ).toBe(ALLOWED);
    expect(boundRoot(fixture)).toBe(realpathSync(fixture.b));
    expect(runGuard({ cwd: fixture.a, state: fixture.state }).status).toBe(
      BLOCKED
    );
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      ALLOWED
    );
  });

  it("refuses an unoffered target even when it belongs to the same repo", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    offeredAcknowledgement(fixture);
    const result = runGuard({
      cwd: fixture.a,
      state: fixture.state,
      input: { command: `echo '${ACCEPT} ${fixture.main}'` },
    });
    expect(result.status).toBe(BLOCKED);
    expect(boundRoot(fixture)).toBe(realpathSync(fixture.a));
  });

  it("accepts return to the original root from a displaced linked worktree", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(
      runGuard({
        cwd: fixture.b,
        state: fixture.state,
        input: {
          command: `cd "${fixture.a}" && echo '${ACCEPT} ${fixture.a}'`,
        },
      }).status
    ).toBe(ALLOWED);
    expect(runGuard({ cwd: fixture.a, state: fixture.state }).status).toBe(
      ALLOWED
    );
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      BLOCKED
    );
  });

  it("remembers the original root after a deliberate observed rebind", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(
      runGuard({
        cwd: fixture.b,
        state: fixture.state,
        input: { command: `echo '${ACCEPT} ${fixture.b}'` },
      }).status
    ).toBe(ALLOWED);
    expect(
      runGuard({
        cwd: fixture.b,
        state: fixture.state,
        input: { command: `echo '${ACCEPT} ${fixture.a}'` },
      }).status
    ).toBe(ALLOWED);
    expect(runGuard({ cwd: fixture.a, state: fixture.state }).status).toBe(
      ALLOWED
    );
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      BLOCKED
    );
  });

  it("allows return to the original root from outside a repository", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    runGuard({
      cwd: fixture.b,
      state: fixture.state,
      input: { command: `echo '${ACCEPT} ${fixture.b}'` },
    });
    expect(
      runGuard({
        cwd: path.dirname(fixture.main),
        state: fixture.state,
        input: { command: `echo '${ACCEPT} ${fixture.a}'` },
      }).status
    ).toBe(ALLOWED);
    expect(runGuard({ cwd: fixture.a, state: fixture.state }).status).toBe(
      ALLOWED
    );
  });

  it("does not spend acknowledgement text printed as data to rebind", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(
      runGuard({
        cwd: fixture.b,
        state: fixture.state,
        input: { command: `printf '%s' '${ACCEPT} ${fixture.b}'` },
      }).status
    ).toBe(BLOCKED);
    expect(boundRoot(fixture)).toBe(realpathSync(fixture.a));
  });
});
