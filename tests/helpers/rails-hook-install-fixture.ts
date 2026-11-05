import * as fs from "fs-extra";
import path from "node:path";
import { env } from "node:process";
import { GIT_BIN } from "../support/git-executable.js";

import { boundedExecFileSync, boundedSpawnSync } from "./io-latency-budget.js";
import {
  cleanGitEnv,
  createRailsProject,
  createTempDir,
} from "./test-utils.js";

export const RAILS_HOOKS = [
  "pre-commit",
  "commit-msg",
  "prepare-commit-msg",
  "pre-push",
] as const;

const ROOT = process.cwd();
const BASE_PLUGIN = "plugins/lisa";

/** Isolated real Git plus a deliberately synthetic Bundler installation control. */
export interface RailsHookFixture {
  readonly root: string;
  readonly project: string;
  readonly bin: string;
  readonly journal: string;
  readonly env: NodeJS.ProcessEnv;
}

/**
 * Create a genuine Rails-shaped Git checkout with no installed hooks.
 * @returns Isolated checkout and synthetic Bundler controls
 */
export async function createRailsHookFixture(): Promise<RailsHookFixture> {
  const root = await createTempDir();
  const project = path.join(root, "project");
  const bin = path.join(root, "bin");
  const journal = path.join(root, "bundle-calls");
  await createRailsProject(project);
  await fs.ensureDir(path.join(project, "node_modules"));
  await fs.ensureDir(bin);
  await fs.writeJson(path.join(project, "package.json"), {
    name: "rails-hook-fixture",
    private: true,
  });
  await fs.writeJson(path.join(project, ".lisa.config.json"), {
    harness: "codex",
    autoUpdate: false,
  });
  await fs.copyFile(
    path.join(ROOT, "rails/copy-overwrite/lefthook.yml"),
    path.join(project, "lefthook.yml")
  );
  await fs.writeFile(path.join(project, ".gitignore"), "node_modules/\n");
  const bundle = path.join(bin, "bundle");
  await fs.writeFile(
    bundle,
    [
      "#!/bin/sh",
      'printf "%s\\n" "$*" >> "$LISA_TEST_BUNDLE_JOURNAL"',
      'if [ "$LISA_TEST_BUNDLE_FAIL" = "1" ]; then echo "fixture install refused" >&2; exit 32; fi',
      'if [ "$1 $2 $3" != "exec lefthook install" ]; then exit 33; fi',
      "hooks=$(git rev-parse --path-format=absolute --git-path hooks) || exit 34",
      'mkdir -p "$hooks" || exit 35',
      `for name in ${RAILS_HOOKS.join(" ")}; do`,
      '  printf "#!/bin/sh\\n# lefthook synthetic component fixture\\nexit 0\\n" > "$hooks/$name"',
      '  chmod 700 "$hooks/$name"',
      "done",
      "",
    ].join("\n")
  );
  await fs.chmod(bundle, 0o700);
  const fixture = {
    root,
    project,
    bin,
    journal,
    env: cleanGitEnv(env, {
      PATH: `${bin}${path.delimiter}${env.PATH ?? ""}`,
      LISA_TEST_BUNDLE_JOURNAL: journal,
      CLAUDE_PLUGIN_ROOT: path.join(ROOT, BASE_PLUGIN),
      PLUGIN_ROOT: path.join(ROOT, BASE_PLUGIN),
    }),
  };
  fixtureGit(fixture, ["init", "--quiet", "--initial-branch=main"]);
  fixtureGit(fixture, ["add", "."]);
  fixtureGit(fixture, [
    "-c",
    "user.name=Lisa fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--quiet",
    "-m",
    "test: seed Rails hook fixture",
  ]);
  return fixture;
}

/**
 * Run genuine Git without inheriting the enclosing push's repository state.
 * @param fixture Isolated checkout
 * @param args Literal Git arguments
 * @param cwd Checkout or linked worktree
 * @returns Trimmed command output
 */
export function fixtureGit(
  fixture: RailsHookFixture,
  args: readonly string[],
  cwd = fixture.project
): string {
  return boundedExecFileSync({
    label: "Rails hook fixture Git",
    command: GIT_BIN,
    args,
    cwd,
    env: fixture.env,
    stdio: "pipe",
  }).trim();
}

/**
 * Resolve exactly the path Git will execute, including linked/custom paths.
 * @param fixture Isolated checkout
 * @param cwd Checkout or linked worktree
 * @returns Absolute Git-selected hooks directory
 */
export function fixtureHooksDirectory(
  fixture: RailsHookFixture,
  cwd = fixture.project
): string {
  return fixtureGit(
    fixture,
    ["rev-parse", "--path-format=absolute", "--git-path", "hooks"],
    cwd
  );
}

/**
 * Read actual executable wrapper state; these component fixtures are synthetic.
 * @param fixture Isolated checkout
 * @param cwd Checkout or linked worktree
 * @returns Names of installed component wrappers
 */
export async function installedFixtureHooks(
  fixture: RailsHookFixture,
  cwd = fixture.project
): Promise<readonly string[]> {
  const directory = fixtureHooksDirectory(fixture, cwd);
  const present = await Promise.all(
    RAILS_HOOKS.map(async name => {
      const file = path.join(directory, name);
      if (!(await fs.pathExists(file))) return undefined;
      const stat = await fs.stat(file);
      const text = await fs.readFile(file, "utf8");
      return stat.isFile() &&
        (stat.mode & 0o100) !== 0 &&
        /lefthook/i.test(text)
        ? name
        : undefined;
    })
  );
  return present.filter((name): name is (typeof RAILS_HOOKS)[number] =>
    Boolean(name)
  );
}

/**
 * Seed component wrappers through the test-owned Bundle command.
 * @param fixture Isolated checkout
 * @param cwd Checkout or linked worktree
 */
export function seedFixtureHooks(
  fixture: RailsHookFixture,
  cwd = fixture.project
): void {
  boundedExecFileSync({
    label: "synthetic Rails hook installation control",
    command: "bundle",
    args: ["exec", "lefthook", "install"],
    cwd,
    env: fixture.env,
    stdio: "pipe",
  });
}

/**
 * Execute the real registered installer cohort, including native variant shims.
 * @param fixture Isolated checkout
 * @param manifestPath Generated agent manifest
 * @param cwd Checkout or linked worktree
 * @param overrides Failure-control environment
 * @returns Actual bounded child outcomes
 */
export async function runFixtureStartup(
  fixture: RailsHookFixture,
  manifestPath: string,
  cwd = fixture.project,
  overrides: NodeJS.ProcessEnv = {}
): Promise<readonly ReturnType<typeof boundedSpawnSync>[]> {
  const manifest = await fs.readJson(path.join(ROOT, manifestPath));
  const hooks = (manifest.hooks.SessionStart ??
    manifest.hooks.sessionStart) as readonly {
    readonly matcher?: string;
    readonly command?: string;
    readonly hooks?: readonly { readonly command?: string }[];
  }[];
  const commands = hooks
    .filter(group => group.matcher === "startup" || group.matcher === undefined)
    .flatMap(group => group.hooks ?? [group])
    .map(hook => hook.command ?? "")
    .filter(command => /\/install-(?:pkgs|rails-hooks)\.sh\b/.test(command));
  const pluginRoot = path.join(
    ROOT,
    manifestPath.split("/").slice(0, 2).join("/")
  );
  return commands.map(command => {
    // Manifest tokens are expanded per argument, so spaces in the plugin root
    // are preserved without evaluating arbitrary shell expressions.
    const args = command.split(" ").map(argument => {
      if (
        !/^\$\{(?:CLAUDE_PLUGIN_ROOT|CURSOR_PLUGIN_ROOT|PLUGIN_ROOT)\}\/hooks\/[\w-]+\.sh$/.test(
          argument
        )
      )
        throw new Error(`Unexpected startup command: ${command}`);
      return argument.replace(/^\$\{[^}]+\}/, pluginRoot);
    });
    return boundedSpawnSync({
      label: "registered Rails startup installer",
      command: "bash",
      args,
      cwd,
      env: {
        ...fixture.env,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        CURSOR_PLUGIN_ROOT: pluginRoot,
        PLUGIN_ROOT: pluginRoot,
        ...overrides,
      },
      input: "{}",
    });
  });
}
