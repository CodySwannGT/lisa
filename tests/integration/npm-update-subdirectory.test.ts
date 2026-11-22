/**
 * Native proof that the npm updater can update a committed subdirectory npm
 * project (CodySwannGT/lisa#4741), driven through the real CLI entry point.
 *
 * The host commits a root project with its own bun.lock plus an `externals/`
 * npm project with a package-lock.json, and a two-entry `npmUpdater` policy.
 * Selecting `externals` with LISA_NPM_DIRECTORY must produce a proposal whose
 * files are exactly the two externals npm files, leaving the root bun.lock
 * untouched; an uncommitted selection must be refused before any npm work.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import { qualifiedUpdaterNode } from "../support/qualified-updater-node.js";
import {
  runNpm,
  runProcess,
  withPrivateRoot,
} from "../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";

useIoLatencyBudget();
const CLI = new URL(
  "../../all/copy-overwrite/scripts/lisa-npm-updater.mjs",
  import.meta.url
).pathname;
const VERSION = "7.0.0";
const ROOT_BUN = "# root project lock, owned by the root project\n";
const ENTRY = {
  version: 1,
  repository: "fixture/host",
  target: "main",
  maintainer: "Fixture",
  lisaOwner: "absent",
  packages: [{ name: "is-number", version: VERSION }],
};
const CONFIG = {
  tracker: "github",
  github: { org: "fixture", repo: "host" },
  automationProvenance: { enabled: true, repository: "fixture/host" },
  npmUpdater: [
    { ...ENTRY, directory: "." },
    { ...ENTRY, directory: "externals" },
  ],
};

/**
 * Commit a root project with a Bun lock and a separate externals npm project.
 * @param root - Positively owned native fixture root.
 * @param env - Original sanitized candidate environment.
 * @returns The committed host checkout.
 */
async function host(root: string, env: NodeJS.ProcessEnv) {
  const cwd = join(root, "host");
  const externals = join(cwd, "externals");
  const git = (args: string[]) => runProcess("git", args, { cwd, env });
  const manifest = (name: string) =>
    JSON.stringify({
      name,
      version: "1.0.0",
      private: true,
      dependencies: { "is-number": "6.0.0" },
    });
  mkdirSync(externals, { recursive: true, mode: 0o700 });
  writeFileSync(join(cwd, "package.json"), manifest("fixture-root"));
  writeFileSync(join(externals, "package.json"), manifest("fixture-externals"));
  for (const directory of [cwd, externals])
    await runNpm(
      [
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      { cwd: directory, env, timeout: 120_000 }
    );
  writeFileSync(join(cwd, "bun.lock"), ROOT_BUN);
  writeFileSync(join(cwd, ".lisa.config.json"), JSON.stringify(CONFIG));
  await git(["init"]);
  await git(["add", "--all"]);
  await git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-m",
    "Committed root and externals npm projects",
  ]);
  return cwd;
}

/**
 * Run one real CLI phase under the qualified updater Node.
 * @param cwd - Committed host checkout.
 * @param phase - Private phase directory.
 * @param env - Original sanitized candidate environment.
 * @param directory - LISA_NPM_DIRECTORY selection.
 * @returns The actual process result.
 */
function prepare(
  cwd: string,
  phase: string,
  env: NodeJS.ProcessEnv,
  directory: string
) {
  const runtime = qualifiedUpdaterNode();
  return runProcess(runtime.path, [CLI, "prepare", cwd, phase], {
    cwd,
    env: {
      ...env,
      PATH: `${dirname(runtime.path)}${delimiter}${env.PATH ?? ""}`,
      LISA_NPM_DIRECTORY: directory,
    },
    timeout: 180_000,
    allowed: [0, 1],
  });
}

describe("native subdirectory npm project update", () => {
  it("prepares exactly the selected externals files and leaves the root Bun lock alone", async () => {
    const observed = await withPrivateRoot(async (root, env) => {
      const cwd = await host(root, env);
      const result = await prepare(cwd, join(root, "phase"), env, "externals");
      const proposal = JSON.parse(
        readFileSync(join(root, "phase", "proposal.json"), "utf8")
      );
      return {
        code: result.code,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
        proposal,
        rootBun: readFileSync(join(cwd, "bun.lock"), "utf8"),
        status: (
          await runProcess("git", ["status", "--porcelain"], { cwd, env })
        ).stdout.toString(),
      };
    });
    console.log(
      "native-subdirectory-observation",
      JSON.stringify({
        code: observed.code,
        stdout: observed.stdout,
        directory: observed.proposal.directory,
        files: Object.keys(observed.proposal.files).sort((a, b) =>
          a.localeCompare(b)
        ),
        updates: observed.proposal.updates,
      })
    );
    expect(observed.code, observed.stderr).toBe(0);
    expect(observed.stdout).toBe("prepared\n");
    expect(observed.proposal.directory).toBe("externals");
    expect(
      Object.keys(observed.proposal.files).sort((a, b) => a.localeCompare(b))
    ).toEqual(["externals/package-lock.json", "externals/package.json"]);
    expect(Object.hasOwn(observed.proposal, "bunLockSha256")).toBe(false);
    expect(observed.proposal.updates).toEqual([
      {
        name: "is-number",
        section: "dependencies",
        from: "6.0.0",
        to: VERSION,
      },
    ]);
    expect(
      JSON.parse(observed.proposal.files["externals/package.json"]).name
    ).toBe("fixture-externals");
    expect(observed.rootBun).toBe(ROOT_BUN);
    expect(observed.status).toBe("");
  });

  it.each(["missing", "../escape"])(
    "refuses the uncommitted or escaping selection %s before any npm work",
    async directory => {
      const observed = await withPrivateRoot(async (root, env) => {
        const cwd = await host(root, env);
        const result = await prepare(cwd, join(root, "phase"), env, directory);
        return {
          code: result.code,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
          // The selection is refused before the phase directory is even created.
          phase: existsSync(join(root, "phase")),
        };
      });
      console.log("native-subdirectory-refusal", JSON.stringify(observed));
      expect(observed.code).toBe(1);
      expect(observed.stdout).toBe("");
      // The CLI prints only the public stage, never the policy text it refused.
      expect(observed.stderr).toBe(
        "npm updater failed: required policy, authorization, installation, gate or exact publication evidence was unavailable (stage=configuration)\n"
      );
      expect(observed.phase).toBe(false);
    }
  );
});
