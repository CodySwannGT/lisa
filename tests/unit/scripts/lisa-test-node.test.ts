/**
 * Tests for the `.mjs` suite runner.
 *
 * The assertions that carry weight are the two silences this script exists to
 * break. `node --test` exits 0 when its glob matches nothing, and that glob
 * descends into `node_modules`, so the naive one-line script would both run
 * other people's suites and report a clean pass having run none of yours.
 * @module tests/unit/scripts/lisa-test-node
 */

import {
  globSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collect,
  EXCLUDED_GLOBS,
  EXCLUDED_SEGMENTS,
  isOwnTest,
  main,
  run,
  TEST_GLOB,
} from "../../../all/copy-overwrite/scripts/lisa-test-node.mjs";

/**
 * Every `globSync` call the module under test made, with its options.
 *
 * The options are the assertion that matters: what `collect` hands the walker
 * cannot be recovered from its return value, because the post-hoc filter
 * produces the same list whether or not anything was pruned. That equivalence
 * is exactly the defect — a walk that materialises every vendored path before
 * filtering aborts on the heap limit in a tree with nested checkouts.
 */
const { globCalls } = vi.hoisted(() => ({
  globCalls: [] as { options: unknown; pattern: string }[],
}));

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: actual,
    globSync: (pattern: string, options?: unknown) => {
      globCalls[globCalls.length] = { options, pattern };
      return (actual.globSync as (p: string, o?: unknown) => string[])(
        pattern,
        options
      );
    },
  };
});

const SUITE = "a.test.mjs";
const SUITE_B = "b.test.mjs";
const NESTED = "scripts/b.test.mjs";
const OWN_SUITE = "mine.test.mjs";
const VENDORED_SUITE = "node_modules/theirs/x.test.mjs";

let temps: string[] = [];

afterEach(() => {
  for (const dir of temps) rmSync(dir, { force: true, recursive: true });
  temps = [];
  globCalls.length = 0;
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

describe("EXCLUDED_GLOBS", () => {
  it("is one prune pattern per excluded segment", () => {
    // Derived rather than written out: a segment added to one list and
    // forgotten in the other is how a policy that is already correct gets
    // applied one step too late.
    expect(EXCLUDED_GLOBS).toEqual([
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.git/**",
      "**/.lisabak/**",
      "**/worktrees/**",
      "**/.worktrees/**",
    ]);
    expect(EXCLUDED_GLOBS).toHaveLength(EXCLUDED_SEGMENTS.length);
  });

  it("prunes under node:fs's `exclude` and is discarded under `ignore`", () => {
    // `ignore` is the `glob` NPM package's spelling. `node:fs` silently drops
    // keys it does not know, so the intuitive fix is a no-op that still
    // exhausts the heap and still reads as correct. Measured on v22.22.0.
    const root = project([OWN_SUITE, VENDORED_SUITE]);
    expect(globSync(TEST_GLOB, { cwd: root, exclude: EXCLUDED_GLOBS })).toEqual(
      [OWN_SUITE]
    );
    expect(
      globSync(TEST_GLOB, {
        cwd: root,
        ignore: EXCLUDED_GLOBS,
      } as never)
    ).toHaveLength(2);
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
    const root = project([OWN_SUITE, VENDORED_SUITE]);
    expect(collect(root)).toEqual([OWN_SUITE]);
  });

  it("prunes excluded trees during the walk, not after it", () => {
    // The return value cannot tell these apart, so the call is asserted
    // instead. Without `exclude` the walk descends into every nested
    // checkout's node_modules and dies on the heap limit — exit 134 — before
    // the filter this list feeds ever runs.
    const root = project([OWN_SUITE, VENDORED_SUITE]);
    collect(root);
    expect(globCalls).toHaveLength(1);
    // Strict, because `toEqual` treats an absent key and an `undefined` one as
    // the same thing — which is precisely the difference under test here.
    expect(globCalls[0]).toStrictEqual({
      options: { cwd: root, exclude: EXCLUDED_GLOBS },
      pattern: TEST_GLOB,
    });
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
