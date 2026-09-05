/**
 * Two guards, one corpus, one contract.
 *
 * `parity-safety-net.sh` and `worktree-binding-guard.mjs` both answer "which
 * file will this command actually execute?", and both once answered it the same
 * wrong way: a relative token resolved against the hook process's own working
 * directory rather than the directory the command will have once it runs its
 * own leading `cd` (CodySwannGT/lisa#3933, inherited in #3951).
 *
 * ## What this suite is, and what it deliberately is not
 *
 * It is NOT proof that the duplicate implementation is gone — it is not, and
 * CodySwannGT/lisa#3952 records that this does not meet its own stated bar. The
 * two guards are in different languages, and there is no call that reaches from
 * Node into a shell function's file-scope state, so one implementation was never
 * available. What is available is one written contract and one set of rows both
 * guards are driven over, so a divergence fails HERE, on the commit that causes
 * it, instead of surfacing later as a wrong verdict found by whoever is unlucky.
 *
 * The residual is real and is stated in the corpus: a behaviour with no row is
 * free to diverge. Add a row when you add a branch.
 *
 * ## Why the rows assert a path and never an exit code
 *
 * The guards fail in opposite directions on purpose. `parity-safety-net.sh`
 * refuses what it cannot classify, because a destructive command it cannot see
 * is the thing it exists to stop. `worktree-binding-guard.mjs` fails open, which
 * is the doctrine every undecidable case in that file follows. Binding them on
 * the verdict would force one of them to be wrong, so they are bound on the
 * resolution.
 * @module tests/unit/hooks/cwd-resolution-corpus-parity
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  ALLOWED,
  BLOCKED,
  bindNode,
  buildDirs,
  candidates,
  expand,
  expandDir,
  probeNode,
  probeShell,
  UNCLASSIFIABLE,
  UNKNOWN_DIRECTORY,
  type Dirs,
} from "./support/cwd-resolution.js";

/** One row of the shared corpus. */
interface Row {
  readonly id: string;
  readonly contract: readonly number[];
  readonly control: string;
  readonly applies: readonly string[];
  readonly command: string;
  readonly expect: { readonly dir: string; readonly script: string } | string;
  readonly why: string;
}

const CORPUS = path.resolve(
  "tests/unit/hooks/support/cwd-resolution-corpus.json"
);
const corpus = JSON.parse(readFileSync(CORPUS, "utf8")) as {
  readonly rows: readonly Row[];
};

let dirs: Dirs;

beforeAll(() => {
  dirs = buildDirs();
  bindNode(dirs);
});

/**
 * The directory a row expects, or null when it expects no resolution at all.
 * @param row - The corpus row
 * @returns The absolute expected directory, or null
 */
function expected(row: Row): string | null {
  if (typeof row.expect === "string") return null;
  return expandDir(row.expect.dir, dirs);
}

/**
 * Every candidate directory the row does NOT expect.
 * @param row - The corpus row
 * @returns Absolute decoy directories
 */
function decoys(row: Row): readonly string[] {
  const target = expected(row);
  return candidates(dirs).filter(dir => dir !== target);
}

describe("the shared cwd-resolution corpus binds both guards", () => {
  it("has rows", () => {
    expect(corpus.rows.length).toBeGreaterThan(0);
  });

  for (const row of corpus.rows) {
    describe(`${row.id} — ${row.why}`, () => {
      if (row.applies.includes("shell")) {
        it("parity-safety-net.sh reads the copy the command would run", () => {
          const command = expand(row.command, dirs);
          const target = expected(row);
          if (row.expect === "unknown") {
            const verdict = probeShell(command, dirs, dirs.session);
            expect(verdict.status).toBe(BLOCKED);
            expect(verdict.stderr).toContain(UNCLASSIFIABLE);
            return;
          }
          if (target === null) {
            expect(probeShell(command, dirs, dirs.session).status).toBe(
              ALLOWED
            );
            return;
          }
          expect(probeShell(command, dirs, target).status).toBe(BLOCKED);
        });

        it("parity-safety-net.sh does NOT read any other copy", () => {
          const command = expand(row.command, dirs);
          const target = expected(row);
          if (target === null) return;
          for (const decoy of decoys(row)) {
            const verdict = probeShell(command, dirs, decoy);
            expect(
              verdict.status,
              `read ${path.join(decoy, "run.sh")} instead of ${path.join(target, "run.sh")}`
            ).toBe(ALLOWED);
          }
        });
      }

      if (row.applies.includes("node")) {
        it("worktree-binding-guard.mjs reads the copy the command would run", () => {
          const command = expand(row.command, dirs);
          const target = expected(row);
          if (row.expect === "unknown") {
            const verdict = probeNode(command, dirs, dirs.session);
            expect(verdict.status).toBe(ALLOWED);
            expect(verdict.stderr).toContain(UNKNOWN_DIRECTORY);
            return;
          }
          if (target === null) {
            expect(probeNode(command, dirs, dirs.session).status).toBe(ALLOWED);
            return;
          }
          const verdict = probeNode(command, dirs, target);
          expect(verdict.status).toBe(BLOCKED);
          expect(verdict.stderr).toContain(path.join(target, "run.sh"));
        });

        it("worktree-binding-guard.mjs does NOT read any other copy", () => {
          const command = expand(row.command, dirs);
          const target = expected(row);
          if (target === null) return;
          for (const decoy of decoys(row)) {
            const verdict = probeNode(command, dirs, decoy);
            expect(
              verdict.status,
              `read ${path.join(decoy, "run.sh")} instead of ${path.join(target, "run.sh")}`
            ).toBe(ALLOWED);
          }
        });
      }
    });
  }
});
