/** Native shell-boundary controls for explicit worktree acknowledgements. */
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ALLOWED,
  BLOCKED,
  bindTo,
  buildFixture,
  git,
  runGuard,
  SESSION,
  stateKey,
  type Fixture,
} from "./support/worktree-binding.js";

const ACCEPT = "lisa-worktree-binding: accept";

/**
 * Read the actual recorded root, without inferring it from a verdict.
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

describe("literal acknowledgement command boundaries", () => {
  it.each(["\n", "\r", "\u00a0"])(
    "does not turn a non-shell word separator %j into an acknowledgement",
    separator => {
      const fixture = buildFixture();
      bindTo(fixture, fixture.a);
      const command = `echo${separator}'${ACCEPT} ${fixture.b}'`;
      expect(
        runGuard({ cwd: fixture.b, state: fixture.state, input: { command } })
          .status
      ).toBe(BLOCKED);
      expect(boundRoot(fixture)).toBe(realpathSync(fixture.a));
    }
  );

  it.each([
    (root: string) => `\u00a0echo '${ACCEPT} ${root}'`,
    (_root: string) => `echo '${ACCEPT} '`,
    (root: string) => `printf '%s' '${ACCEPT} ${root}'`,
    (root: string) => `echo '${ACCEPT} ${root}' && echo extra`,
    (root: string) => `echo '${ACCEPT} ${root}'; echo extra`,
    (root: string) => `echo "${ACCEPT} $(printf '%s' '${root}')"`,
    (root: string) => `cat <<'EOF'\n${ACCEPT} ${root}\nEOF`,
    (root: string) => `cd '~' && echo '${ACCEPT} ${root}'`,
    (root: string) => `cd '-' && echo '${ACCEPT} ${root}'`,
    (root: string) => `cd '--' && echo '${ACCEPT} ${root}'`,
    (root: string) => `cd '${root}' '&&' echo '${ACCEPT} ${root}'`,
    (root: string) => `cd '${root}' \\&\\& echo '${ACCEPT} ${root}'`,
    (root: string) => `cd && && echo '${ACCEPT} ${root}'`,
  ])("does not consume data, suffixes, or expansions", commandFor => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(
      runGuard({
        cwd: fixture.b,
        state: fixture.state,
        input: { command: commandFor(fixture.b) },
      }).status
    ).toBe(BLOCKED);
    expect(boundRoot(fixture)).toBe(realpathSync(fixture.a));
  });

  it.each([
    (root: string) => `echo\t"${ACCEPT} ${root}"`,
    (root: string) => `echo \\\n'${ACCEPT} ${root}'`,
  ])(
    "accepts actual shell word spacing and escaped continuation",
    commandFor => {
      const fixture = buildFixture();
      bindTo(fixture, fixture.a);
      expect(
        runGuard({
          cwd: fixture.b,
          state: fixture.state,
          input: { command: commandFor(fixture.b) },
        }).status
      ).toBe(ALLOWED);
      expect(boundRoot(fixture)).toBe(realpathSync(fixture.b));
    }
  );

  it("refuses an acknowledgement whose cd names a different root", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    expect(
      runGuard({
        cwd: fixture.b,
        state: fixture.state,
        input: {
          command: `cd '${fixture.b}' && echo '${ACCEPT} ${fixture.a}'`,
        },
      }).status
    ).toBe(BLOCKED);
    expect(boundRoot(fixture)).toBe(realpathSync(fixture.a));
  });

  it("accepts the printed recovery line for a root with spaces and an apostrophe", () => {
    const fixture = buildFixture();
    const quoted = path.join(path.dirname(fixture.main), "quoted' root");
    git(fixture.main, ["worktree", "move", fixture.b, quoted]);
    bindTo(fixture, fixture.a);
    const refusal = runGuard({ cwd: quoted, state: fixture.state });
    expect(refusal.status).toBe(BLOCKED);
    const command = refusal.stderr
      .split("\n")
      .find(line => line.trim().startsWith("echo "))
      ?.trim();
    if (!command) throw new Error("Missing recovery acknowledgement");
    expect(
      runGuard({ cwd: quoted, state: fixture.state, input: { command } }).status
    ).toBe(ALLOWED);
    expect(boundRoot(fixture)).toBe(realpathSync(quoted));
  });

  it("keeps a quoted cd target literal when the original path contains a dollar sign", () => {
    const fixture = buildFixture();
    const original = path.join(path.dirname(fixture.main), "original-$literal");
    git(fixture.main, ["worktree", "move", fixture.a, original]);
    bindTo(fixture, original);
    expect(
      runGuard({
        cwd: fixture.b,
        state: fixture.state,
        input: { command: `cd '${original}' && echo '${ACCEPT} ${original}'` },
      }).status
    ).toBe(ALLOWED);
    expect(boundRoot(fixture)).toBe(realpathSync(original));
  });

  it("recovers the original root after an unconfirmed EnterWorktree claim", () => {
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    runGuard({
      cwd: fixture.a,
      state: fixture.state,
      tool: "EnterWorktree",
      event: "PostToolUse",
      input: { path: fixture.b },
    });
    expect(runGuard({ cwd: fixture.a, state: fixture.state }).status).toBe(
      BLOCKED
    );
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
    expect(boundRoot(fixture)).toBe(realpathSync(fixture.a));
  });
});
