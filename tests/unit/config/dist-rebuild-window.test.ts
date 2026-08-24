/**
 * No test may delete this checkout's `dist/` out from under a concurrent reader.
 *
 * `build:dist` opens with `clean-dist.mjs`, an `rm -rf` of the whole `dist/`
 * directory, and `tsc` then rebuilds it file by file. A test that runs it does
 * so in the REAL checkout, so anything else reading `dist/` during the gap gets
 * ENOENT on a file that is present again moments later.
 *
 * Measured by polling for existence every 25 ms across one run of
 * `tests/integration/cli-smoke.test.ts` (CodySwannGT/lisa#3054):
 *
 * | file | absent for |
 * |---|---|
 * | `dist/index.js` | 5,218 ms |
 * | `dist/configs/eslint/slow.js` | 5,143 ms |
 * | `dist/configs/vitest/typescript.d.ts` | 5,168 ms |
 *
 * Those are not arbitrary paths: the second and third are the two files that
 * failed `bun run lint:slow` with ENOENT on two consecutive invocations while a
 * full-suite run was in flight, each present again immediately afterwards. The
 * same probe over a `tsc`-only rebuild recorded zero gaps.
 *
 * The window is per-checkout, not cross-checkout: `clean-dist.mjs` resolves
 * `dist` from its own location, so a sibling worktree's build cannot reach this
 * one. The concurrency that bites is inside a single checkout — the integration
 * suite against anything else reading `dist/`.
 *
 * This is a structural pin rather than a timing test on purpose. Racing a real
 * build to observe a gap is exactly the kind of test that becomes flaky and
 * then gets deleted; the property that closes the window is that no test
 * invokes a build which wipes first, and that is decidable from the scripts.
 * @module tests/unit/config/dist-rebuild-window
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SMOKE_BUILD_SCRIPT } from "../../helpers/smoke-build.js";

/** This repository's root, from this file's own location. */
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/** The script whose first act is to delete `dist/` wholesale. */
const DESTRUCTIVE_STEP = "clean-dist";

/**
 * The `scripts` block of this repository's package.json.
 * @returns Script name to command line.
 */
const scripts = (): Readonly<Record<string, string>> =>
  (
    JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;

/**
 * Expand a script's command line one level, so a `bun run <other>` inside it is
 * judged by what IT runs rather than by its name.
 * @param name - Script to resolve
 * @returns The command line with one level of `bun run` indirection expanded.
 */
const expanded = (name: string): string => {
  const all = scripts();
  const command = all[name] ?? "";
  return [...command.matchAll(/bun run ([\w:-]+)/g)].reduce(
    (text, match) => `${text} ${all[match[1]] ?? ""}`,
    command
  );
};

describe("the build a test runs must not wipe dist first", () => {
  it("declares the in-place build the smoke test names", () => {
    expect(scripts()[SMOKE_BUILD_SCRIPT]).toBeDefined();
  });

  it("runs a build that never deletes dist", () => {
    // The bite: pre-fix the smoke test named `build:dist`, whose command line
    // opens with `node scripts/clean-dist.mjs`, and this fails on it.
    expect(
      expanded(SMOKE_BUILD_SCRIPT),
      "a test that wipes this checkout's dist/ takes every concurrent reader " +
        "of it down with ENOENT on a file that is present again seconds later"
    ).not.toContain(DESTRUCTIVE_STEP);
  });

  it("still compiles and copies, so the smoke test builds a real CLI", () => {
    // The control. "Does not delete" is trivially satisfiable by doing nothing,
    // and a smoke test over a stale dist proves nothing about the build.
    const command = scripts()[SMOKE_BUILD_SCRIPT] ?? "";

    expect(command).toContain("tsc");
    expect(command).toContain("copy-codex-scripts");
  });

  it("leaves the real build destructive, because removing stale output is its job", () => {
    // `build:dist` is not the thing being changed. A build that never removes
    // anything ships whatever an earlier commit emitted, which is a different
    // and worse defect than the one being fixed here.
    expect(scripts()["build:dist"]).toContain(DESTRUCTIVE_STEP);
  });
});
