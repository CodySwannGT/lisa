/** Worktree binding resolves every row of the shared cwd-resolution corpus. */
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

describe("the shared cwd-resolution corpus binds worktree-binding-guard", () => {
  it("has rows", () => {
    expect(corpus.rows.length).toBeGreaterThan(0);
  });

  for (const row of corpus.rows.filter(item => item.applies.includes("node"))) {
    describe(`${row.id} — ${row.why}`, () => {
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
