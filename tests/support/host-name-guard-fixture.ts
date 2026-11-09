/** Shared actual-wrapper fixtures; inspected commands are never executed. */
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../helpers/io-latency-budget.js";
import { resolveGit } from "./git-executable.js";

/** git, resolved to a fixed path rather than through a writeable PATH. */
const GIT = resolveGit();

/** The executable guard filename. */
export const HOOK_BASENAME = "block-host-name-leak.sh";

/** The guard under test, as it lives in the plugin source. */
export const SCRIPT_PATH = path.resolve(
  "plugins/src/base/hooks/block-host-name-leak.sh"
);
/** Claude's refusal code. Anything else lets the command through. */
export const EXIT_BLOCKED = 2;
export const EXIT_ALLOWED = 0;
/** A name that is not a host identity, supplied through the documented env. */
export const FIXTURE_NAME = "notarealhostproject";
/** The repository root, where the compiled detector lives. */
export const PROJECT_DIR = process.cwd();

/**
 * A throwaway directory for body fixtures.
 * @returns The directory path.
 */
export const scratch = (): string =>
  mkdtempSync(path.join(tmpdir(), "lisa-hnl-"));

/**
 * Write a body file and return its path.
 * @param contents - The body text.
 * @returns The file path.
 */
export const bodyFile = (contents: string): string => {
  const file = path.join(scratch(), "body.md");
  writeFileSync(file, contents, "utf-8");
  return file;
};

/**
 * Isolate temporary repositories and local gh routing from the parent hook.
 * @returns The fixture child environment.
 */
export const fixtureEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^(?:GIT_|GH_|GITHUB_)/u.test(key)
    )
  );

/**
 * Run the hook against one command.
 * @param command - The command the agent is about to run.
 * @param names - Names to load into the denylist for this run.
 * @param projectDir - The project the hook governs (its cwd and CLAUDE_PROJECT_DIR).
 * @returns Exit status and combined output.
 */
export const runHook = (
  command: string,
  names: string = FIXTURE_NAME,
  projectDir: string = PROJECT_DIR
): { status: number; output: string } => {
  const result = boundedSpawnSync({
    label: HOOK_BASENAME,
    command: "/bin/bash",
    args: [SCRIPT_PATH],
    cwd: projectDir,
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    env: {
      ...fixtureEnv(),
      GH_TOKEN: "local-fixture-no-network-token",
      GH_PROMPT_DISABLED: "1",
      CLAUDE_PROJECT_DIR: projectDir,
      LISA_DOWNSTREAM_NAMES: names,
    },
  });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
};

/**
 * A host project's checkout: a git repository whose origin is not this one,
 * with Lisa installed the way hosts install it — `dist/` reachable under
 * `node_modules/@codyswann/lisa`, which is exactly what lets the guard load its
 * denylist inside a host (#4462).
 * @param origin - The origin remote URL, or undefined for no git repository.
 * @returns The checkout directory.
 */
export const hostCheckout = (origin: string | undefined): string => {
  const dir = scratch();
  mkdirSync(path.join(dir, "node_modules", "@codyswann", "lisa"), {
    recursive: true,
  });
  symlinkSync(
    path.join(PROJECT_DIR, "dist"),
    path.join(dir, "node_modules", "@codyswann", "lisa", "dist")
  );
  if (origin !== undefined) {
    const git = (args: string[]): string =>
      boundedExecFileSync({
        label: "git (host checkout fixture)",
        command: GIT,
        args: ["-C", dir, ...args],
        env: fixtureEnv(),
      });
    git(["init", "-q"]);
    git(["remote", "add", "origin", origin]);
  }
  return dir;
};
