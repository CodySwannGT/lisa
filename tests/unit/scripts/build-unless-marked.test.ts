/**
 * `scripts/build-unless-marked.mjs` is the build step of Lisa's
 * `lisa-test-run` (CodySwannGT/lisa#4595). It may skip the build only on a
 * matching marker; every other case builds exactly as before (#3778).
 * @module tests/unit/scripts/build-unless-marked
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BUILD_MARKER_SCHEMA } from "../../../all/copy-overwrite/scripts/lib/build-marker.mjs";
import { main } from "../../../scripts/build-unless-marked.mjs";

const TREE = "a".repeat(40);
const OTHER_TREE = "b".repeat(40);
const CURRENT = { tree: TREE, lockfile: null, node: "22.0.0", bun: "1.2.0" };
const PROBE = "--probe-plugins";
const SKIP_LINE = `build skipped: marker matches tree ${TREE}`;
const roots: string[] = [];

/**
 * Write a marker for a tree and return the env naming it.
 * @param builtTree - Tree the marker records as built
 * @param pluginsCleanBeforeBuild - Recorded plugin cleanliness
 * @returns Environment and working directory
 */
function marked(
  builtTree: string,
  pluginsCleanBeforeBuild = true
): { env: Record<string, string>; cwd: string } {
  const cwd = mkdtempSync(path.join(tmpdir(), "lisa-build-unless-"));
  roots.push(cwd);
  const file = path.join(cwd, "marker.json");
  writeFileSync(
    file,
    JSON.stringify({
      schema: BUILD_MARKER_SCHEMA,
      tree: builtTree,
      builtTree,
      lockfile: null,
      node: CURRENT.node,
      bun: CURRENT.bun,
      pluginsCleanBeforeBuild,
    })
  );
  return { env: { LISA_BUILD_MARKER: file }, cwd };
}

/**
 * Run the script with recording seams.
 * @param argv - Arguments
 * @param setup - Environment and working directory
 * @param setup.env - Environment
 * @param setup.cwd - Working directory
 * @returns Exit code, build count and log lines
 */
function run(
  argv: string[],
  { env, cwd }: { env: Record<string, string>; cwd: string }
) {
  const lines: string[] = [];
  let builds = 0;
  const code = main(argv, {
    cwd,
    env,
    fingerprint: () => CURRENT,
    build: () => {
      builds += 1;
      return 0;
    },
    log: line => lines.push(line),
  });
  return { code, builds, lines };
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("build-unless-marked", () => {
  it("builds exactly as before when LISA_BUILD_MARKER is unset", () => {
    const { code, builds, lines } = run([], { env: {}, cwd: tmpdir() });
    expect(code).toBe(0);
    expect(builds).toBe(1);
    expect(lines).toEqual([]);
  });

  it("skips the build when the marker matches the current tree", () => {
    const { code, builds, lines } = run([], marked(TREE));
    expect(code).toBe(0);
    expect(builds).toBe(0);
    expect(lines).toEqual([SKIP_LINE]);
  });

  it("rebuilds when the marker names a different tree", () => {
    const { builds, lines } = run([], marked(OTHER_TREE));
    expect(builds).toBe(1);
    expect(lines[0]).toMatch(/^building: tree /u);
  });

  it("rebuilds when the named marker does not exist", () => {
    const { builds } = run([], {
      env: { LISA_BUILD_MARKER: path.join(tmpdir(), "no-such-marker.json") },
      cwd: tmpdir(),
    });
    expect(builds).toBe(1);
  });

  it("propagates a failing build's exit code", () => {
    const code = main([], {
      env: {},
      fingerprint: () => CURRENT,
      build: () => 3,
      log: () => {},
    });
    expect(code).toBe(3);
  });

  describe(PROBE, () => {
    it("passes only for a matching marker with plugins clean before the build", () => {
      const probe = run([PROBE], marked(TREE));
      expect(probe).toEqual({ code: 0, builds: 0, lines: [SKIP_LINE] });
    });

    it("fails when plugins were dirty before the build", () => {
      expect(run([PROBE], marked(TREE, false))).toMatchObject({
        code: 1,
        builds: 0,
      });
    });

    it("fails on a mismatched or absent marker, and never builds", () => {
      expect(run([PROBE], marked(OTHER_TREE))).toMatchObject({
        code: 1,
        builds: 0,
      });
      expect(run([PROBE], { env: {}, cwd: tmpdir() })).toMatchObject({
        code: 1,
        builds: 0,
      });
    });
  });
});
