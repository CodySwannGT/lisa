/**
 * The setup field's exit status is the FIRST checkout failure.
 *
 * `SKILL.md` states it outright — "The exit status is the first failure, and
 * every checkout is still attempted: one broken repository must not hide the
 * state of the others" — and a bare `rc=$?` kept the last one instead. With two
 * broken checkouts the operator saw the second and the first was lost, which is
 * exactly the hiding that sentence promises against.
 *
 * Executed rather than pattern-matched. The parity tests already assert what
 * the field's text says; nothing ran the loop, which is why a contract stated in
 * prose and contradicted by the code survived.
 * @module tests/unit/secrets/setup-field-first-failure
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SETUP_FIELD } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/** Where the field looks for a checkout's entrypoint. */
const ENTRYPOINT = "scripts/lisa-remote-env/setup.sh";

/**
 * Run the field over checkouts whose entrypoints exit with the given codes.
 *
 * Directories are named so the field's glob visits them in this order, because
 * "first" is only meaningful against a known order.
 *
 * Each entrypoint touches a marker before exiting, so a caller can tell "the
 * status was right" from "every checkout actually ran". Those are different
 * claims, and an implementation that stopped at the first failure would satisfy
 * the first while breaking the documented contract.
 * @param codes Exit code per checkout, in visit order.
 * @returns The field's exit status, and which entrypoints executed.
 */
function runOver(codes: readonly number[]): {
  status: number;
  ran: readonly boolean[];
} {
  const home = mkdtempSync(path.join(tmpdir(), "lisa-first-"));
  const marker = (index: number): string => path.join(home, `ran-${index}`);

  try {
    codes.forEach((code, index) => {
      const repo = path.join(home, `repo-${index}`);
      mkdirSync(path.join(repo, path.dirname(ENTRYPOINT)), { recursive: true });
      writeFileSync(
        path.join(repo, ENTRYPOINT),
        `: > "${marker(index)}"\nexit ${code}\n`
      );
    });

    let status = 0;
    try {
      execFileSync("/bin/sh", ["-c", SETUP_FIELD], {
        cwd: home,
        env: { ...process.env, HOME: home },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      status = (error as { status: number }).status;
    }

    return { status, ran: codes.map((_, index) => existsSync(marker(index))) };
  } finally {
    // Read before removal, above: the markers live in the directory being
    // deleted. A test that leaves one temporary tree per call is a slow leak
    // nobody notices until CI runs out of inodes.
    rmSync(home, { recursive: true, force: true });
  }
}

describe("the setup field's exit status across several checkouts", () => {
  it("reports the FIRST failure, not the last", () => {
    // The defect: 4 would be reported, and the 3 that happened first — the one
    // an operator would start from — was gone.
    expect(runOver([3, 4]).status).toBe(3);
  });

  it("still reports a failure that comes after a success", () => {
    expect(runOver([0, 5]).status).toBe(5);
  });

  it("keeps the first failure when a success follows it", () => {
    // `||` only fires on failure, so a success cannot overwrite `rc`. Pinned
    // because the obvious "fix" of assigning unconditionally would break it.
    expect(runOver([6, 0]).status).toBe(6);
  });

  it("succeeds when every checkout succeeds", () => {
    expect(runOver([0, 0]).status).toBe(0);
  });

  it("attempts every checkout even after one fails", () => {
    // The other half of the sentence: one broken repository must not stop the
    // others being prepared.
    //
    // The status alone cannot show this — an implementation that exits the
    // moment repo-0 fails also returns 7 — so each entrypoint leaves a marker
    // and all three must be there.
    const { status, ran } = runOver([7, 0, 0]);

    expect(ran).toEqual([true, true, true]);
    expect(status).toBe(7);
  });
});
