import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  boundedExecFileSync,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { SMOKE_BUILD_SCRIPT } from "../helpers/smoke-build.js";

// The bounded children below are handed a base that only fits under a case
// budget scaling with the same machine they do. Without this call the case
// budget is the flat one from `vitest.config.local.ts`, and the child's bound
// overtakes it from a slowdown of 4.0x up — a range measured on this box, in
// this tree, in the run that fixed CodySwannGT/lisa#3202.
useIoLatencyBudget();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");

/**
 * Run a repo command and return stdout as a string.
 * @param command - Executable name
 * @param args - Command arguments
 * @returns Captured stdout
 */
function run(command: string, args: readonly string[]): string {
  return boundedExecFileSync({
    label: `${command} ${args.join(" ")}`,
    command,
    args,
    // The heaviest caller is the `bun run build:dist` hook, one `tsc`.
    baseMs: 30_000,
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LISA_SKIP_UPDATE_CHECK: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("built Lisa CLI smoke", () => {
  // Build ONLY the dist CLI, NOT the full `bun run build`. The full build ends
  // in `build:plugins`, which deletes and regenerates plugins/** in place; when
  // this integration test shares a `vitest run` with the unit suite (test /
  // test:cov), that rebuild intermittently removes plugins/** out from under
  // unit tests reading those generated artifacts (flaky ENOENT). The CLI smoke
  // only needs dist/index.js, so it must never run build:plugins.
  //
  // And IN PLACE, not `build:dist` (CodySwannGT/lisa#3054). `build:dist` opens
  // with `clean-dist.mjs`, an `rm -rf` of this checkout's whole `dist/`, and
  // `tsc` then rebuilds it file by file. Measured by polling for existence
  // every 25 ms across one run of this file: `dist/index.js`,
  // `dist/configs/eslint/slow.js` and `dist/configs/vitest/typescript.d.ts`
  // were each ABSENT for about 5.2 seconds. Anything else reading `dist/` in
  // that window fails on ENOENT — measured twice on `bun run lint:slow`, on two
  // different files, each present again moments later, while a full-suite run
  // was in flight.
  //
  // The same shape is already recorded twice in this repository: the comment
  // above about `build:plugins`, and the mutation gate's own configuration
  // comment on the integration suite rebuilding `dist/` under a sandbox scan.
  // That tool is deliberately not named here — a sibling guard classifies any
  // integration suite MENTIONING it as one that drives it, and requires such a
  // suite to be excluded from the push pass. This file does not drive it, and
  // prose should not be what makes a detector think otherwise.
  //
  // The wipe buys this test nothing — `tsc` overwrites in place, and freshness
  // is proved by the artifact gates rather than here. The same probe over a
  // `tsc`-only rebuild recorded ZERO gaps. `build:dist` keeps the wipe for the
  // real build, where removing stale output is the point.
  // Scaled, not fixed. This hook is one `tsc` invocation, and the cost
  // of a subprocess on this hardware is a property of the machine rather
  // than of the build (CodySwannGT/lisa#2822). `ioLatencyBudgetMs` is
  // clamped at 1 from below, so on a quiet box this is still 120,000ms
  // and a genuinely stuck build still fails in about the time it always
  // did — the number can only widen under measured load, never tighten.
  beforeAll(() => {
    run("bun", ["run", SMOKE_BUILD_SCRIPT]);
  }, ioLatencyBudgetMs(120_000));

  it("prints help for the built artifact with every public subcommand", () => {
    const help = run("node", [DIST_CLI, "--help"]);

    expect(help).toContain("apply");
    expect(help).toContain("setup-project");
    expect(help).toContain("setup-wiki");
    expect(help).toContain("doctor");
    expect(help).toContain("version");
    expect(help).toContain("update");
    expect(help).toContain("check-learnings-budget");
    expect(help).toContain("file-upstream");
  });

  it("prints the package version from the built artifact", () => {
    const version = run("node", [DIST_CLI, "--version"]).trim();

    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(version).not.toBe("1.0.0");
  });

  it("documents setup-project types in the built command help", () => {
    const help = run("node", [DIST_CLI, "setup-project", "--help"]);

    expect(help).toContain("Project type:");
    expect(help).toContain("rails");
    expect(help).toContain("harper-wiki");
  });
});
