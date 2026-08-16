/**
 * Tests for the `.mjs` suite runner.
 *
 * The assertions that carry weight are the two silences this script exists to
 * break. `node --test` exits 0 when its glob matches nothing, and that glob
 * descends into `node_modules`, so the naive one-line script would both run
 * other people's suites and report a clean pass having run none of yours.
 * @module tests/unit/scripts/lisa-test-node
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collect,
  isOwnTest,
  main,
  run,
  TEST_GLOB,
} from "../../../all/copy-overwrite/scripts/lisa-test-node.mjs";

const SUITE = "a.test.mjs";
const SUITE_B = "b.test.mjs";
const NESTED = "scripts/b.test.mjs";

let temps: string[] = [];

afterEach(() => {
  for (const dir of temps) rmSync(dir, { force: true, recursive: true });
  temps = [];
});

/**
 * Build a project tree containing the given relative files.
 * @param files - Project-relative paths to create
 * @returns The project root
 */
function project(files: readonly string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-test-node-"));
  temps.push(root);
  for (const file of files) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(
      full,
      'import { test } from "node:test";\ntest("x", () => {});\n'
    );
  }
  return root;
}

/**
 * Collect everything a run writes, so the transcript can be asserted.
 * @returns A writer plus the text it captured
 */
function transcript() {
  const lines: string[] = [];
  return {
    read: () => lines.join(""),
    write: (text: string) => {
      lines[lines.length] = text;
    },
  };
}

describe("isOwnTest", () => {
  it("keeps a project's own suites", () => {
    expect(isOwnTest("scripts/check-thing.test.mjs")).toBe(true);
    expect(isOwnTest(path.join("deep", "nested", "path", SUITE))).toBe(true);
  });

  it("rejects vendored and generated trees", () => {
    // Measured: `**/*.test.ts` matches 1175 files in this repo, 470 of them
    // inside node_modules. Running those reports other people's failures as
    // yours.
    for (const excluded of [
      `node_modules/zod/${SUITE}`,
      `dist/${SUITE}`,
      `build/${SUITE}`,
      `worktrees/wt/${SUITE}`,
      `.worktrees/wt/${SUITE}`,
      `deep/node_modules/pkg/${SUITE}`,
    ]) {
      expect(isOwnTest(excluded), excluded).toBe(false);
    }
  });

  it("matches path SEGMENTS, not substrings", () => {
    // A directory legitimately named `distribution` starts with `dist`. A
    // substring check would silently drop that project's whole test tree.
    expect(isOwnTest(`distribution/${SUITE}`)).toBe(true);
    expect(isOwnTest(`builder/${SUITE}`)).toBe(true);
    expect(isOwnTest(`my-worktrees-notes/${SUITE}`)).toBe(true);
  });
});

describe("collect", () => {
  it("finds suites anywhere in the tree", () => {
    const root = project([SUITE, NESTED, "deep/nested/c.test.mjs"]);
    expect(collect(root)).toEqual([
      SUITE,
      path.join("deep", "nested", "c.test.mjs"),
      path.join("scripts", SUITE_B),
    ]);
  });

  it("excludes vendored trees it would otherwise match", () => {
    const root = project(["mine.test.mjs", "node_modules/theirs/x.test.mjs"]);
    expect(collect(root)).toEqual(["mine.test.mjs"]);
  });

  it("ignores files that merely resemble a suite", () => {
    const root = project([SUITE, "nope.mjs", "b.spec.mjs", "c.test.ts"]);
    expect(collect(root)).toEqual([SUITE]);
  });

  it("returns empty rather than throwing when there are none", () => {
    expect(collect(project([]))).toEqual([]);
  });
});

describe("run", () => {
  it("passes the collected files explicitly, never the glob", () => {
    // What runs must be exactly what was reported as collected. Re-globbing
    // inside the runner would let the log describe one set while another ran.
    const seen: string[][] = [];
    const exec = (_bin: string, args: string[]) => {
      seen[seen.length] = args;
      return { status: 0 };
    };
    run([SUITE, SUITE_B], exec as never);
    expect(seen[0]).toEqual(["--test", SUITE, SUITE_B]);
    expect(seen[0]?.join(" ")).not.toContain(TEST_GLOB);
  });

  it("propagates a failing status", () => {
    expect(run([SUITE], (() => ({ status: 1 })) as never)).toBe(1);
  });

  it("treats a signal-killed run as failure, not success", () => {
    // spawnSync reports a null status when the child is killed. Returning 0
    // there would call an interrupted run a pass.
    expect(run([SUITE], (() => ({ status: null })) as never)).toBe(1);
  });
});

describe("main", () => {
  it("fails the empty case out loud rather than exiting quietly", () => {
    // `node --test` exits 0 on a glob matching nothing, so this wrapper must
    // make the empty collection explicit and red.
    const out = transcript();
    const status = main({ write: out.write, cwd: project([]) });
    expect(status).toBe(1);
    expect(out.read()).toContain("collected 0");
    expect(out.read()).toContain("nothing to run");
  });

  it("names every suite it collected", () => {
    // So a reader can tell "ran everything and passed" from "ran nothing" —
    // the distinction that was missing and that made the defect invisible.
    const out = transcript();
    main({
      write: out.write,
      cwd: project([SUITE, NESTED]),
      exec: (() => ({ status: 0 })) as never,
    });
    expect(out.read()).toContain("collected 2");
    expect(out.read()).toContain(SUITE);
    expect(out.read()).toContain(path.join("scripts", SUITE_B));
  });

  it("fails when a collected suite fails", () => {
    const out = transcript();
    expect(
      main({
        write: out.write,
        cwd: project([SUITE]),
        exec: (() => ({ status: 1 })) as never,
      })
    ).toBe(1);
  });
});
