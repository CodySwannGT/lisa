import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  boundedExecFileSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

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
  // The package test runner builds once before starting concurrent suites.

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
