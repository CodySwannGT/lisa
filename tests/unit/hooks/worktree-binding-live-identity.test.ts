/** Live identity controls: stale Git worktree registrations are not authority. */
import { readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
 * Read the guard's persisted root as an independent assertion.
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
 * Inspect a script reference without executing its proposed command.
 * @param fixture - Owned native fixture
 * @returns Guard verdict
 */
const reach = (fixture: Fixture) => {
  const script = path.join(fixture.a, "visit.sh");
  writeFileSync(script, `ls "${fixture.b}"\n`);
  return runGuard({
    cwd: fixture.a,
    state: fixture.state,
    input: { command: `bash "${script}"` },
  });
};

describe("binding compares live repository identity", () => {
  it.each(["independent", "removed"])(
    "recovers the original root independently of the current binding (%s)",
    current => {
      const fixture = buildFixture();
      bindTo(fixture, fixture.a);
      const next =
        current === "independent"
          ? path.join(path.dirname(fixture.main), "independent")
          : fixture.b;
      if (current === "independent") git(fixture.main, ["init", QUIET, next]);
      expect(
        runGuard({
          cwd: next,
          state: fixture.state,
          input: { command: `echo '${ACCEPT} ${next}'` },
        }).status
      ).toBe(ALLOWED);
      if (current === "removed") rmSync(next, { recursive: true, force: true });
      expect(
        runGuard({
          cwd: path.dirname(fixture.main),
          state: fixture.state,
          input: { command: `echo '${ACCEPT} ${fixture.a}'` },
        }).status
      ).toBe(ALLOWED);
      expect(boundRoot(fixture)).toBe(realpathSync(fixture.a));
      expect(runGuard({ cwd: fixture.a, state: fixture.state }).status).toBe(
        ALLOWED
      );
    }
  );

  it.each([false, true])(
    "does not accept a stale offered root (independent replacement=%s)",
    replace => {
      const fixture = buildFixture();
      bindTo(fixture, fixture.a);
      expect(reach(fixture).status).toBe(BLOCKED);
      // Delete only this owned fixture directory; leave its stale registration.
      rmSync(fixture.b, { recursive: true, force: true });
      if (replace) git(fixture.main, ["init", QUIET, fixture.b]);
      expect(
        runGuard({
          cwd: fixture.a,
          state: fixture.state,
          input: { command: `echo '${ACCEPT} ${fixture.b}'` },
        }).status
      ).toBe(BLOCKED);
      expect(boundRoot(fixture)).toBe(realpathSync(fixture.a));
    }
  );

  it("allows an independent cwd replacing a stale registered path", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    rmSync(fixture.b, { recursive: true, force: true });
    git(fixture.main, ["init", QUIET, fixture.b]);
    expect(runGuard({ cwd: fixture.b, state: fixture.state }).status).toBe(
      ALLOWED
    );
    expect(boundRoot(fixture)).toBe(realpathSync(fixture.a));
    expect(reach(fixture).status).toBe(ALLOWED);
  });

  it.each([false, true])(
    "does not restore a missing or replaced original root (replacement=%s)",
    replace => {
      const fixture = buildFixture();
      bindTo(fixture, fixture.a);
      expect(
        runGuard({
          cwd: fixture.b,
          state: fixture.state,
          input: { command: `echo '${ACCEPT} ${fixture.b}'` },
        }).status
      ).toBe(ALLOWED);
      rmSync(fixture.a, { recursive: true, force: true });
      if (replace) git(fixture.main, ["init", QUIET, fixture.a]);
      expect(
        runGuard({
          cwd: path.dirname(fixture.main),
          state: fixture.state,
          input: { command: `echo '${ACCEPT} ${fixture.a}'` },
        }).status
      ).toBe(BLOCKED);
      expect(boundRoot(fixture)).toBe(realpathSync(fixture.b));
    }
  );
});
