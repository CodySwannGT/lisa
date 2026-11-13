/**
 * `lisa check` — run the push gates BEFORE `git push` (CodySwannGT/lisa#4601).
 *
 * Git opens the remote connection before the pre-push hook runs, and a push
 * whose hook runs past roughly 35 minutes dies with exit 141 even when every
 * gate passes (CodySwannGT/lisa#4505). Waiting for machine headroom inside a
 * push is therefore dangerous. This command runs the same gate set as the push
 * (`lisa-run-gates.mjs --moment=push`, through the same runner, so the pass
 * cache, build-once and the push timing report all apply) outside the push,
 * where a long admission wait is harmless. Every pass it proves is recorded
 * against `HEAD`'s tree, so the `git push` that follows reports each cacheable
 * gate as `CACHED PASS` and finishes in seconds.
 *
 * Three refusals keep it honest:
 *
 * - When the project's `pushGate.cache` is off (the default for every host until
 *   its template turns it on), it runs nothing and exits 0: the push would run
 *   every gate again anyway, so checking first would only double the wait. That
 *   is what lets the agent skills instruct `lisa check` unconditionally.
 * - When the working tree is not clean it exits 1 and says to commit first: the
 *   cache only records a pass for a clean tree equal to the commit being
 *   pushed, so a check of a dirty tree would prove nothing the push can reuse.
 * - Any failed required gate exits 1, with the runner's own FAILED lines above.
 *
 * In a Rails project (`bin/rails` or `config/application.rb`) the push gates
 * are the lefthook pre-push commands, not the gate registry, so this runs
 * `scripts/lisa-rails-gates.mjs --all` instead (CodySwannGT/lisa#4613): the
 * same RSpec, Brakeman, Reek, Flog and Flay commands, through the same pass
 * cache and admission. There `pushGate.cache` is on unless the project sets it
 * to `false`.
 * @module cli/check-cmd
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Command } from "commander";

import { readProjectConfig } from "../core/project-config.js";
import { RailsDetector } from "../detection/detectors/rails.js";

/** Printed, and exit 0, when checking first would save nothing. */
export const CACHE_OFF_MESSAGE =
  "gate pass cache is off for this project; push directly (the push runs every gate)";

/**
 * How long `lisa check` waits for machine headroom by default. Longer than the
 * five-minute in-push bound on purpose: outside a push nothing times out.
 */
export const DEFAULT_MAX_WAIT = "30m";

/** The admission wait bound the gate runner reads (CodySwannGT/lisa#4596). */
export const MAX_WAIT_ENV = "LISA_ADMISSION_MAX_WAIT";

/** Gate runner exit codes, mirrored from `lisa-run-gates.mjs` `EXIT`. */
const RUNNER_EXIT = { PROVED: 0, BLOCKED: 1, NO_GATES: 78 } as const;

/** Where a project carries its copy of the runner, in lookup order. */
const PROJECT_RUNNERS = [
  path.join("scripts", "lisa-run-gates.mjs"),
  path.join("all", "copy-overwrite", "scripts", "lisa-run-gates.mjs"),
] as const;

/** The Rails pre-push gate script a Rails host carries (CodySwannGT/lisa#4613). */
export const RAILS_RUNNER = path.join("scripts", "lisa-rails-gates.mjs");

/** One invocation of the push-gate runner. */
export interface RunnerRequest {
  /** Absolute path to `lisa-run-gates.mjs`. */
  readonly runner: string;
  /** Runner arguments. */
  readonly args: readonly string[];
  /** Repository root the gates run in. */
  readonly cwd: string;
  /** Child environment. */
  readonly env: NodeJS.ProcessEnv;
}

/** Options parsed from the command line. */
export interface CheckOptions {
  /** Admission wait bound (`1800`, `45s`, `30m`, `2h`). */
  readonly maxWait?: string;
}

/** Injectable collaborators for {@link runCheck}. */
export interface CheckDependencies {
  /** Directory the command was run from. */
  readonly cwd?: string;
  /** Process environment. */
  readonly env?: NodeJS.ProcessEnv;
  /** Informational sink (stdout). */
  readonly log?: (line: string) => void;
  /** Refusal sink (stderr). */
  readonly error?: (line: string) => void;
  /** Runs git; trimmed stdout, or null on failure. */
  readonly git?: (args: readonly string[], cwd: string) => string | null;
  /** Runs the gate runner with inherited output; its exit status. */
  readonly runRunner?: (request: RunnerRequest) => number | null;
  /** Installed Lisa package root, for the shipped runner fallback. */
  readonly lisaRoot?: string;
}

/**
 * Validate a `--max-wait` duration: a positive whole number of seconds, or one
 * suffixed with `s`, `m` or `h` — the forms the admission layer accepts.
 * @param value - Raw flag value
 * @returns The duration unchanged, or null when it is not one
 */
export function parseMaxWait(value: string): string | null {
  const match = /^(\d+)([smh])?$/u.exec(value);
  return match && Number(match[1]) > 0 ? value : null;
}

/**
 * Run git without a shell.
 * @param args - Git arguments
 * @param cwd - Working directory
 * @returns Trimmed stdout, or null when git failed
 */
function defaultGit(args: readonly string[], cwd: string): string | null {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed user-installed git executable, the one the pre-push hook runs under
  const child = spawnSync("git", [...args], { cwd, encoding: "utf8" });
  return child.status === 0 ? String(child.stdout).trim() : null;
}

/**
 * Run the gate runner. stdin is closed: a gate that reads the pushed refs from
 * stdin must see "nothing pushed" and fall back, never wait on a terminal.
 * @param request - The invocation
 * @returns Exit status, or null when killed by a signal
 */
function defaultRunRunner(request: RunnerRequest): number | null {
  const child = spawnSync(process.execPath, [request.runner, ...request.args], {
    cwd: request.cwd,
    env: request.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  return child.status;
}

/**
 * The installed Lisa package root (`dist/cli/..` → package).
 * @returns Absolute path
 */
function defaultLisaRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * The runner the pre-push hook would use, else the one this Lisa ships.
 * @param root - Repository root
 * @param lisaRoot - Installed Lisa package root
 * @returns Absolute runner path, or null when none exists
 */
function locateRunner(root: string, lisaRoot: string): string | null {
  const candidates = [
    ...PROJECT_RUNNERS.map(relative => path.join(root, relative)),
    path.join(lisaRoot, PROJECT_RUNNERS[1]),
  ];
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

/**
 * Why checking first saves nothing here, or null when it may run.
 * @param root - Repository root
 * @param env - Process environment
 * @param rails - Whether this is a Rails project, where the cache defaults on
 * @returns `{skip}` to exit 0 with a line, `{refuse}` to exit 1, or null
 */
async function cacheGate(
  root: string,
  env: NodeJS.ProcessEnv,
  rails: boolean
): Promise<{ skip: string } | { refuse: string } | null> {
  const enabled = await readProjectConfig(root).then(
    config =>
      rails
        ? config.pushGate?.cache !== false
        : config.pushGate?.cache === true,
    (err: unknown) => (err instanceof Error ? err : new Error(String(err)))
  );
  if (enabled instanceof Error) return { refuse: enabled.message };
  if (!enabled) return { skip: CACHE_OFF_MESSAGE };
  if (String(env.LISA_GATE_CACHE ?? "").toLowerCase() === "off") {
    return {
      skip: "gate pass cache is off for this run (LISA_GATE_CACHE=off); push directly (the push runs every gate)",
    };
  }
  if (env.CI || env.GITHUB_ACTIONS) {
    return {
      skip: "CI never reads or writes the gate pass cache; push directly (the push runs every gate)",
    };
  }
  return null;
}

/**
 * Turn the runner's exit status into the command's verdict.
 * @param status - Runner exit status
 * @param tree - The tree that was checked
 * @param log - Informational sink
 * @param error - Refusal sink
 * @returns Command exit code
 */
function verdict(
  status: number | null,
  tree: string,
  log: (line: string) => void,
  error: (line: string) => void
): number {
  if (status === RUNNER_EXIT.PROVED) {
    log(
      `✅ lisa check: every required push gate passed for tree ${tree.slice(0, 12)}. ` +
        "Push now; the push reuses these passes while the tree is unchanged."
    );
    return 0;
  }
  if (status === RUNNER_EXIT.BLOCKED) {
    error(
      "❌ lisa check: a required push gate did not pass — see the FAILED or " +
        "NOT PROVED line above. " +
        "Fix it, commit, and run lisa check again before pushing."
    );
    return 1;
  }
  if (status === RUNNER_EXIT.NO_GATES) {
    log(
      "ℹ️  lisa check: the gate registry does not govern push here, so nothing " +
        "was recorded. Push directly; the push runs its built-in checks."
    );
    return 0;
  }
  error(
    `⚠️  lisa check: the gate runner could not run (exit ${status ?? "signal"}). ` +
      "Nothing was proved — this is NOT a pass."
  );
  return 1;
}

/**
 * Locate the repository and confirm its tree is exactly `HEAD`'s.
 * @param cwd - Directory the command ran from
 * @param git - Git runner
 * @returns The root and tree, or the refusal to print
 */
function cleanHead(
  cwd: string,
  git: NonNullable<CheckDependencies["git"]>
): { root: string } | { refuse: string } {
  const root = git(["rev-parse", "--show-toplevel"], cwd);
  if (!root) {
    return { refuse: "🚫 lisa check: not inside a git repository." };
  }
  const status = git(["status", "--porcelain"], root);
  if (status === null) {
    return { refuse: "🚫 lisa check: git could not read the working tree." };
  }
  if (status !== "") {
    return {
      refuse:
        "🚫 lisa check: the working tree has uncommitted or untracked changes. " +
        "Commit first: a pass is only recorded for the exact commit you push. " +
        "Nothing ran and nothing was recorded.",
    };
  }
  return { root };
}

/**
 * Run the push gates against `HEAD`'s tree ahead of `git push`.
 * @param options - Parsed command options
 * @param dependencies - Injectable collaborators
 * @returns Process exit code (0 proved or nothing to do; 1 otherwise)
 */
export async function runCheck(
  options: CheckOptions,
  dependencies: CheckDependencies = {}
): Promise<number> {
  // eslint-disable-next-line no-restricted-syntax -- the CLI hands its externally supplied environment to the gate runner, as the pre-push hook does
  const env = dependencies.env ?? process.env;
  const log = dependencies.log ?? ((line: string) => console.log(line));
  const error = dependencies.error ?? ((line: string) => console.error(line));
  const git = dependencies.git ?? defaultGit;
  const maxWait = parseMaxWait(options.maxWait ?? DEFAULT_MAX_WAIT);
  if (!maxWait) {
    error(
      `🚫 lisa check: --max-wait ${JSON.stringify(options.maxWait)} is not a ` +
        "duration; use seconds or a number with s, m or h (for example 45m)."
    );
    return 1;
  }
  const head = cleanHead(dependencies.cwd ?? process.cwd(), git);
  if ("refuse" in head) {
    error(head.refuse);
    return 1;
  }
  const rails = await new RailsDetector().detect(head.root);
  const gate = await cacheGate(head.root, env, rails);
  if (gate && "refuse" in gate) {
    error(`🚫 lisa check: ${gate.refuse}`);
    return 1;
  }
  if (gate) {
    log(gate.skip);
    return 0;
  }
  return rails
    ? runRailsGates(head.root, maxWait, env, dependencies, log, error)
    : runPushGates(head.root, maxWait, env, dependencies, log, error);
}

/**
 * Run a Rails host's pre-push gate set through its own gate script.
 * @param root - Repository root
 * @param maxWait - Admission wait bound
 * @param env - Process environment
 * @param dependencies - Injectable collaborators
 * @param log - Informational sink
 * @param error - Refusal sink
 * @returns Process exit code
 */
function runRailsGates(
  root: string,
  maxWait: string,
  env: NodeJS.ProcessEnv,
  dependencies: CheckDependencies,
  log: (line: string) => void,
  error: (line: string) => void
): number {
  const runner = path.join(root, RAILS_RUNNER);
  if (!existsSync(runner)) {
    error(
      `🚫 lisa check: no Rails gate script found (${RAILS_RUNNER}). ` +
        "Run lisa to install it. Nothing was proved."
    );
    return 1;
  }
  const tree =
    (dependencies.git ?? defaultGit)(["rev-parse", "HEAD^{tree}"], root) ?? "";
  const run = dependencies.runRunner ?? defaultRunRunner;
  log(
    `🔎 lisa check: running the Rails push gates for tree ${tree.slice(0, 12)} ` +
      `(waits up to ${maxWait} for machine headroom).`
  );
  return verdict(
    run({
      runner,
      args: ["--all"],
      cwd: root,
      env: { ...env, [MAX_WAIT_ENV]: maxWait },
    }),
    tree,
    log,
    error
  );
}

/**
 * Run the runner once at the push moment and report its verdict.
 * @param root - Repository root
 * @param maxWait - Admission wait bound
 * @param env - Process environment
 * @param dependencies - Injectable collaborators
 * @param log - Informational sink
 * @param error - Refusal sink
 * @returns Process exit code
 */
function runPushGates(
  root: string,
  maxWait: string,
  env: NodeJS.ProcessEnv,
  dependencies: CheckDependencies,
  log: (line: string) => void,
  error: (line: string) => void
): number {
  const git = dependencies.git ?? defaultGit;
  const runner = locateRunner(root, dependencies.lisaRoot ?? defaultLisaRoot());
  if (!runner) {
    error(
      "🚫 lisa check: no gate runner found (scripts/lisa-run-gates.mjs). " +
        "Run lisa to install it. Nothing was proved."
    );
    return 1;
  }
  const tree = git(["rev-parse", "HEAD^{tree}"], root) ?? "";
  // A coverage file, as the pre-push hook passes one: without it the runner
  // withholds a half-declared push moment entirely, and `lisa check` would then
  // run fewer gates than the push it is meant to stand in for.
  const scratch = mkdtempSync(path.join(tmpdir(), "lisa-check-"));
  try {
    log(
      `🔎 lisa check: running the push gates for tree ${tree.slice(0, 12)} ` +
        `(waits up to ${maxWait} for machine headroom).`
    );
    const status = (dependencies.runRunner ?? defaultRunRunner)({
      runner,
      args: ["--moment=push", `--coverage=${path.join(scratch, "coverage")}`],
      cwd: root,
      env: { ...env, [MAX_WAIT_ENV]: maxWait },
    });
    return verdict(status, tree, log, error);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The one collaborator registration needs. */
interface CheckCommandDeps {
  /** Runs the check and returns its exit code. */
  readonly runCheck: (options: CheckOptions) => Promise<number>;
}

/**
 * Register `lisa check`.
 * @param program - Commander program to mutate
 * @param deps - Collaborators (defaults to the real check)
 */
export function addCheckCommand(
  program: Command,
  deps: CheckCommandDeps = { runCheck: options => runCheck(options) }
): void {
  program
    .command("check")
    .description(
      "Run the push gates for HEAD before `git push`, so the push reuses " +
        "their passes and finishes in seconds. Requires a clean working tree; " +
        "does nothing when the project's pushGate.cache is off."
    )
    .option(
      "--max-wait <duration>",
      `How long to wait for machine headroom (seconds, or 45s/30m/2h; default ${DEFAULT_MAX_WAIT})`
    )
    .action(async (options: CheckOptions) => {
      const code = await deps.runCheck(options);
      if (code !== 0) {
        process.exitCode = code;
      }
    });
}
