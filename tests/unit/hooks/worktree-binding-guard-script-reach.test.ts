/**
 * A script whose body reaches into another worktree.
 *
 * CodySwannGT/lisa#3924. The guard compares `payload.cwd` against the bound
 * root, which is the right comparison — but **`payload.cwd` is sampled before
 * the child process runs.** A script that changes directory internally moves
 * AFTER the guard has measured, so the guard is not wrong about the target; it
 * is right about a target that stops being the target one instruction later.
 *
 * A measurement taken before execution cannot bind what execution does. That
 * rules out the whole class of fix a reader reaches for first — resolve
 * harder, resolve the redirect flags too — because none of them are measuring
 * the right moment. The only thing left is to read what is about to run.
 * @module tests/unit/hooks/worktree-binding-guard-script-reach
 */
import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Fixture } from "./support/worktree-binding.js";
import {
  ALLOWED,
  BLOCKED,
  bindTo,
  buildFixture,
  runGuard,
} from "./support/worktree-binding.js";

/** The line every fixture script ends with; the guard never reaches it. */
const GIT_STATUS = "git status";

describe("a script that reaches into another worktree", () => {
  /**
   * Write an executable script into the fixture root.
   * @param fixture - The repository under test
   * @param name - File name
   * @param lines - Script body, one entry per line
   * @returns The absolute path written
   */
  function script(
    fixture: Fixture,
    name: string,
    lines: readonly string[]
  ): string {
    const target = path.join(path.dirname(fixture.main), name);
    writeFileSync(target, `#!/usr/bin/env bash\n${lines.join("\n")}\n`);
    chmodSync(target, 0o755);
    return target;
  }

  it("refuses a script whose body moves to a sibling worktree", () => {
    // THE BITE for CodySwannGT/lisa#3924. Measured permitted before this arm
    // existed: `payload.cwd` is still the bound worktree, because the
    // directory change has not happened yet — it happens inside the child,
    // after the guard has already answered.
    //
    // A measurement taken before execution cannot bind what execution does.
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const reaching = script(fixture, "land.sh", [
      `cd "${fixture.b}" || exit 1`,
      "git add -A && git commit -m landed",
    ]);

    const result = runGuard({
      cwd: fixture.a,
      state: fixture.state,
      input: { command: `bash ${reaching}` },
    });

    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain("reaches into");
    expect(result.stderr).toContain(fixture.b);
  });

  it("refuses a spelling nobody enumerated", () => {
    // The whole point of resolving the target instead of matching the
    // invocation. A relative walk is not in any denylist, and does not need to
    // be: the path resolves into a worktree that is not the bound one, and how
    // it was written never comes up.
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const reaching = script(fixture, "relative.sh", [
      `cd ../${path.basename(fixture.b)} || exit 1`,
      GIT_STATUS,
    ]);

    const result = runGuard({
      cwd: fixture.a,
      state: fixture.state,
      input: { command: `bash ${reaching}` },
    });

    expect(result.status).toBe(BLOCKED);
  });

  it("allows a script that stays inside the bound worktree", () => {
    // Without this the case above is satisfied by an arm that refuses every
    // script, which would be a worse guard than none: it would push all
    // scripted work back inline, where the runtime's own isolation is the only
    // thing left.
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const home = script(fixture, "home.sh", [
      `cd "${fixture.a}" || exit 1`,
      GIT_STATUS,
    ]);

    expect(
      runGuard({
        cwd: fixture.a,
        state: fixture.state,
        input: { command: `bash ${home}` },
      }).status
    ).toBe(ALLOWED);
  });

  it("allows a script that only MENTIONS a sibling worktree in a comment", () => {
    // The control the comment-stripping exists for, and the one a later
    // simplification will break. A script that documents which tree it must
    // not touch would otherwise be refused for saying so — and prose about a
    // subject is the likeliest text to contain that subject's shapes, so the
    // tax falls on whoever writes the warning.
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const prose = script(fixture, "prose.sh", [
      `# Run this from the session's own tree, never from ${fixture.b}.`,
      GIT_STATUS,
    ]);

    expect(
      runGuard({
        cwd: fixture.a,
        state: fixture.state,
        input: { command: `bash ${prose}` },
      }).status
    ).toBe(ALLOWED);
  });

  it("allows READING the same reaching script", () => {
    // The read-versus-execute split. `block-direct-issue-create.sh` had to
    // learn this the expensive way — a guard that opened every file a command
    // named, then judged the COMMAND by that FILE's contents, refused ordinary
    // inspection of the guards themselves. Reading a script that visits
    // another worktree is not visiting it.
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);
    const reaching = script(fixture, "land.sh", [
      `cd "${fixture.b}" || exit 1`,
      GIT_STATUS,
    ]);

    for (const reader of ["cat", "grep -n cd", "head -5", "wc -l"]) {
      expect(
        runGuard({
          cwd: fixture.a,
          state: fixture.state,
          input: { command: `${reader} ${reaching}` },
        }).status
      ).toBe(ALLOWED);
    }
  });

  it("leaves an inline redirect to the runtime, and says so", () => {
    // NOT an oversight. `cd B && git status` and `git -C B status` are already
    // refused by the runtime's own worktree isolation, and duplicating a
    // control is how two controls drift into disagreeing about the same
    // command. The scripted form is the cell neither covers, and it is the
    // only one this arm fills.
    //
    // THE ASSUMPTION THIS CASE ENCODES, AND ITS EXPIRY. Leaving these two
    // uncovered makes Lisa's coverage depend on a runtime Lisa does not ship.
    // Verified refusing at Claude Code CLI 2.1.261, with the refusal wording
    // "this command names git in a form too complex to verify that it stays
    // inside the worktree" and "redirects git to the shared checkout via -C".
    //
    // That claim is version-variable and known to be so: the same evening this
    // was written, CodySwannGT/lisa#3942 measured one plugin version refusing
    // what another permitted, ten minors apart. If a future harness stops
    // refusing these forms, this cell goes uncovered and NOTHING reports it —
    // this suite included, because the runtime's isolation is not reachable
    // from a unit test. There is no CLI entry point that adjudicates one
    // envelope the way this guard does.
    //
    // So the dependency is written down rather than asserted, and the residual
    // — a control depended on and not measurable — is CodySwannGT/lisa#3944.
    // Before widening this arm to cover the inline forms, check that ticket:
    // the reason not to is that the runtime does it, and that reason is the
    // thing that can expire.
    const fixture = buildFixture();
    bindTo(fixture, fixture.a);

    for (const command of [
      `cd ${fixture.b} && git status`,
      `git -C ${fixture.b} status`,
    ]) {
      expect(
        runGuard({ cwd: fixture.a, state: fixture.state, input: { command } })
          .status
      ).toBe(ALLOWED);
    }
  });
});
