import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ioLatencyBudgetMs } from "../helpers/io-latency-budget.js";

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
  return execFileSync(command, [...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      LISA_SKIP_UPDATE_CHECK: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("built Lisa CLI smoke", () => {
  // Build ONLY the dist CLI (`build:dist` = tsc + copy-codex-scripts), NOT the
  // full `bun run build`. The full build ends in `build:plugins`, which deletes
  // and regenerates plugins/** in place; when this integration test shares a
  // `vitest run` with the unit suite (test / test:cov), that rebuild
  // intermittently removes plugins/** out from under unit tests reading those
  // generated artifacts (flaky ENOENT). The CLI smoke only needs dist/index.js,
  // so it must never run build:plugins. Keep this as build:dist.
  // Scaled, not fixed. This hook is one `tsc` invocation, and the cost
  // of a subprocess on this hardware is a property of the machine rather
  // than of the build (CodySwannGT/lisa#2822). `ioLatencyBudgetMs` is
  // clamped at 1 from below, so on a quiet box this is still 120,000ms
  // and a genuinely stuck build still fails in about the time it always
  // did — the number can only widen under measured load, never tighten.
  beforeAll(() => {
    run("bun", ["run", "build:dist"]);
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
