/**
 * Native proof that the hosted gate installs a Bun-only root
 * (CodySwannGT/lisa#4862): a host whose root commits bun.lock and no
 * package-lock.json, plus an `externals/` npm project with its own lock.
 *
 * Before this change the gate always ran `npm ci` at the root, which fails
 * without a root package-lock.json. Now the root installs with frozen Bun,
 * every install input keeps its bytes, and a root npm proposal on such a host
 * is refused rather than installed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import { requireNativeBun } from "./support/native-path-bun.js";
import { installHostedDependencies } from "../../all/copy-overwrite/scripts/lib/npm-update-hosted-gate.mjs";
import {
  runNpm,
  runProcess,
  withPrivateRoot,
} from "../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";

useIoLatencyBudget();
const IGNORE_SCRIPTS = "--ignore-scripts";
const MANIFEST = "package.json";
const NPM_FLAGS = [IGNORE_SCRIPTS, "--no-audit", "--no-fund"];
const INPUTS = [
  "bun.lock",
  MANIFEST,
  "externals/package-lock.json",
  "externals/package.json",
];

/**
 * Commit a Bun-only root and an externals npm project from genuine installer output.
 * @param root - Positively owned native fixture root.
 * @param env - Original sanitized candidate environment.
 * @returns The committed host checkout.
 */
async function bunRootHost(root: string, env: NodeJS.ProcessEnv) {
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
  writeFileSync(join(cwd, MANIFEST), manifest("fixture-bun-root"));
  writeFileSync(join(externals, MANIFEST), manifest("fixture-externals"));
  writeFileSync(join(cwd, ".gitignore"), "node_modules/\n");
  await runProcess("bun", ["install", "--lockfile-only", IGNORE_SCRIPTS], {
    cwd,
    env,
    timeout: 120_000,
  });
  await runNpm(["install", "--package-lock-only", ...NPM_FLAGS], {
    cwd: externals,
    env,
    timeout: 120_000,
  });
  await git(["init"]);
  await git(["add", "--all"]);
  await git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-m",
    "Committed Bun-only root and externals npm project",
  ]);
  return cwd;
}

/**
 * Hosted gate context for one proposal; only the install fields are read.
 * @param cwd - Committed host checkout.
 * @param directory - Proposal directory.
 * @returns The minimal gate context.
 */
function gateContext(cwd: string, directory: string) {
  return {
    cwd,
    deadline: Date.now() + 600_000,
    proposal: directory === "." ? {} : { directory },
  };
}

describe("hosted gate install on a Bun-only root", () => {
  it("installs the root with frozen Bun and keeps every input byte", async () => {
    requireNativeBun();
    const observed = await withPrivateRoot(async (root, env) => {
      const cwd = await bunRootHost(root, env);
      const before = INPUTS.map(name => readFileSync(join(cwd, name)));
      await installHostedDependencies(gateContext(cwd, "externals"), root, env);
      return {
        rootLock: existsSync(join(cwd, "package-lock.json")),
        installed: JSON.parse(
          readFileSync(join(cwd, "node_modules/is-number/package.json"), "utf8")
        ).version,
        unchanged: INPUTS.every((name, index) =>
          readFileSync(join(cwd, name)).equals(before[index]!)
        ),
        status: (
          await runProcess("git", ["status", "--porcelain"], { cwd, env })
        ).stdout.toString(),
      };
    });
    console.log("bun-root-gate-install", JSON.stringify(observed));
    expect(observed).toEqual({
      rootLock: false,
      installed: "6.0.0",
      unchanged: true,
      status: "",
    });
  });

  it("refuses a root npm proposal on a Bun-only root before installing", async () => {
    requireNativeBun();
    const observed = await withPrivateRoot(async (root, env) => {
      const cwd = await bunRootHost(root, env);
      const error = await installHostedDependencies(
        gateContext(cwd, "."),
        root,
        env
      ).catch((caught: Error) => caught);
      return {
        message: error instanceof Error ? error.message : "no error",
        installed: existsSync(join(cwd, "node_modules")),
      };
    });
    expect(observed).toEqual({
      message:
        "Invalid automation provenance: a Bun-only root supports only a subdirectory npm proposal",
      installed: false,
    });
  });
});
