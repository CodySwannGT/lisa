#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * lisa-lint-staged-preflight — prove every tool lint-staged is about to run can
 * actually be started, before lint-staged gets the chance to swallow the answer.
 *
 * Usage:
 *   node scripts/lisa-lint-staged-preflight.mjs --config .lintstagedrc.json
 *   node scripts/lisa-lint-staged-preflight.mjs --config=.lintstagedrc.json
 *
 * ## Why this exists
 *
 * `lint-staged` reports **exit 0** when a task's executable cannot be spawned
 * with `ENOEXEC`, while printing `[FAILED] spawn ENOEXEC` to the terminal. The
 * asymmetry is the whole problem, and it is what defeats the intuition that a
 * broken tool would get noticed. Measured with one harness, three tasks,
 * everything else held constant:
 *
 * | task                                            | 16.2.7 | 16.4.0 | 17.3.0 |
 * | ----------------------------------------------- | ------ | ------ | ------ |
 * | script exits 1 (ordinary failure)               | 1      | 1      | 1      |
 * | executable absent entirely (`ENOENT`)           | 1      | 1      | 1      |
 * | present, `chmod +x`, not executable (`ENOEXEC`) | 1      | **0**  | **0**  |
 *
 * A *missing* tool is caught. A tool that is present but unrunnable is not.
 *
 * That is precisely the state some published tools leave behind. A package
 * whose real binary is materialized during `postinstall` installs a
 * shebang-less placeholder shim first; the shim is written to fail loudly and
 * explain itself, and it would, because it `exit 1`s. lint-staged spawns
 * without a shell, so no shebang plus no shell means the kernel returns
 * `ENOEXEC` before the shim's own `exit 1` can ever run. Skip `postinstall` —
 * which is a route agents take routinely — and the task runs, reports nothing,
 * and blocks nothing, while the commit proceeds.
 *
 * ## Why hardening the hook could not fix it
 *
 * Worth stating, because it is the obvious first response. The hook already
 * captures lint-staged's status and exits on it. No exit-code check can catch
 * a process that reports `0` for work it did not do. The answer has to arrive
 * *before* the handoff, from something that spawns the tools itself.
 *
 * ## What "invocable" means here, and why it is measured rather than inferred
 *
 * This guard does not read the file's first bytes looking for a shebang or an
 * object-file magic number and reason about what the kernel would do with them.
 * It spawns each executable, shell-less, exactly as lint-staged will, and
 * watches for the `spawn` event. `ENOEXEC`, `ENOENT` and `EACCES` all arrive as
 * an `error` event instead, which is the signal. The probe passes when — and
 * only when — the operating system really started the process.
 *
 * `--version` is the probe argument because every tool Lisa ships in
 * `.lintstagedrc.json` answers it instantly. The exit code is deliberately
 * ignored: a tool that rejects `--version` still *started*, which is the entire
 * question. A tool that hangs is also a pass for the same reason — it started —
 * so the probe kills it and moves on.
 *
 * ## Silence is not the success signal
 *
 * The defect being fixed is a control reporting success for work it no longer
 * performs, so this file refuses to be a second instance of it:
 *
 * - It prints one line per executable it probed and a count. A run that proved
 *   nothing cannot look like a run that proved everything.
 * - A config it cannot read, cannot parse, or whose shape it does not
 *   understand is a FAILURE, never a quiet pass.
 * - A config that declares no tasks is a FAILURE: lint-staged would prove
 *   nothing, and "nothing to check" is exactly the report this guard exists to
 *   stop trusting.
 * - Extracting zero executables from a config that has tasks is a FAILURE.
 * - Executable-name extraction that disagrees with lint-staged's own
 *   tokenization can only produce a name that fails to spawn, which this guard
 *   reports loudly. It has no path to a silent pass.
 * @module scripts/lisa-lint-staged-preflight
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** Default config path, matching what the shipped pre-commit hook passes. */
const DEFAULT_CONFIG = ".lintstagedrc.json";

/** Argument handed to each probed executable. */
const PROBE_ARGS = Object.freeze(["--version"]);

/**
 * How long a probe waits before concluding the process really did start.
 *
 * Only reached by a tool that spawns and then neither exits nor is killed.
 * Since spawning is the whole question, a timeout is a PASS.
 */
const PROBE_TIMEOUT_MS = 15_000;

/**
 * The config path named on the command line.
 *
 * Accepts `--config X` and `--config=X` because the hook and a human invoking
 * this by hand write it both ways.
 * @param {string[]} argv - Arguments after the script name.
 * @returns {string} Config path, relative or absolute.
 */
export const configPathFrom = argv => {
  const inline = argv.find(arg => arg.startsWith("--config="));
  if (inline !== undefined) return inline.slice("--config=".length);
  const flagAt = argv.indexOf("--config");
  if (flagAt >= 0 && argv[flagAt + 1] !== undefined) return argv[flagAt + 1];
  return DEFAULT_CONFIG;
};

/**
 * The executable a lint-staged task string spawns.
 *
 * lint-staged splits the task with `string-argv` and spawns element zero, so
 * this reproduces that for element zero only: quoted runs are unwrapped, and
 * the token ends at the first unquoted whitespace. A disagreement with
 * `string-argv` on an exotic task string yields a name that will not spawn,
 * which this guard reports — never a name it silently skips.
 * @param {string} command - A lint-staged task string.
 * @returns {string} The executable name, or "" when the task is blank.
 */
export const executableOf = command => {
  let token = "";
  let quote = "";
  for (const character of command) {
    if (quote !== "") {
      if (character === quote) quote = "";
      else token += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/u.test(character)) {
      if (token !== "") break;
    } else {
      token += character;
    }
  }
  return token;
};

/**
 * Every task string a lint-staged JSON config declares.
 * @param {unknown} config - Parsed config contents.
 * @returns {{ tasks: string[] } | { problem: string }} Tasks, or why not.
 */
export const tasksOf = config => {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return { problem: "the config is not a JSON object of glob → task(s)" };
  }
  const tasks = [];
  for (const [glob, value] of Object.entries(config)) {
    if (typeof value === "string") {
      tasks.push(value);
    } else if (
      Array.isArray(value) &&
      value.every(v => typeof v === "string")
    ) {
      tasks.push(...value);
    } else {
      return {
        problem: `the entry for "${glob}" is neither a task string nor an array of them`,
      };
    }
  }
  return { tasks };
};

/**
 * The environment a probe runs in: PATH augmented the way lint-staged's own
 * spawner augments it, so a locally installed tool resolves identically.
 *
 * `node_modules/.bin` is prepended for the working directory and every ancestor
 * of it, then the directory holding the running Node binary.
 * @param {string} cwd - Directory the probe runs in.
 * @returns {NodeJS.ProcessEnv} Environment for the probe.
 */
export const probeEnv = cwd => {
  const binDirectories = [];
  let current = cwd;
  let previous = "";
  while (current !== previous) {
    binDirectories.push(path.resolve(current, "node_modules", ".bin"));
    previous = current;
    current = path.dirname(current);
  }
  binDirectories.push(path.dirname(process.execPath));

  const key =
    Object.keys(process.env).find(name => /^path$/iu.test(name)) ?? "PATH";
  const existing = process.env[key] ?? "";
  return {
    ...process.env,
    [key]: [
      ...binDirectories,
      ...(existing === "" ? [] : existing.split(path.delimiter)),
    ].join(path.delimiter),
  };
};

/**
 * Start one executable and report whether the operating system started it.
 *
 * Shell-less on POSIX, matching how lint-staged spawns and therefore matching
 * the `ENOEXEC` this guard exists to catch. On win32 the shell is used because
 * that is how `.cmd` shims are invoked there; `ENOEXEC` in the sense meant here
 * is a POSIX `execve` outcome and has no win32 counterpart.
 * @param {string} executable - Name or path to start.
 * @param {string} cwd - Directory to start it in.
 * @param {NodeJS.ProcessEnv} env - Environment to start it with.
 * @returns {Promise<{ executable: string, started: boolean, code?: string, detail?: string }>} Probe outcome.
 */
export const probe = (executable, cwd, env) =>
  new Promise(resolve => {
    let settled = false;
    /**
     * Resolve once, ignoring any later event from the same child.
     * @param {{ executable: string, started: boolean, code?: string, detail?: string }} outcome - What happened.
     * @returns {void}
     */
    const settle = outcome => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    let child;
    try {
      child = spawn(executable, [...PROBE_ARGS], {
        cwd,
        env,
        stdio: "ignore",
        shell: process.platform === "win32",
        timeout: PROBE_TIMEOUT_MS,
      });
    } catch (error) {
      settle({
        executable,
        started: false,
        code: /** @type {NodeJS.ErrnoException} */ (error).code ?? "FAILED",
        detail: /** @type {Error} */ (error).message,
      });
      return;
    }

    child.on("error", error => {
      settle({
        executable,
        started: false,
        code: /** @type {NodeJS.ErrnoException} */ (error).code ?? "FAILED",
        detail: error.message,
      });
    });
    child.on("spawn", () => {
      child.kill();
      settle({ executable, started: true });
    });
  });

/**
 * Refuse to continue, saying what could not be established.
 * @param {string} reason - Operator-readable reason.
 * @param {string[]} [remedy] - Lines telling the reader what to do.
 * @returns {number} Exit code 1.
 */
const refuse = (reason, remedy = []) => {
  process.stderr.write(`\n❌ lint-staged preflight: ${reason}\n`);
  for (const line of remedy) process.stderr.write(`   ${line}\n`);
  process.stderr.write(
    "\n   Nothing was proved about the tools lint-staged would run, so the\n" +
      "   commit is blocked rather than allowed to look checked.\n\n"
  );
  return 1;
};

/**
 * Run the preflight.
 * @param {string[]} argv - Arguments after the script name.
 * @param {string} cwd - Directory the probes run in.
 * @returns {Promise<number>} Process exit code.
 */
export const run = async (argv, cwd) => {
  const configPath = configPathFrom(argv);
  const absolute = path.resolve(cwd, configPath);
  if (!existsSync(absolute)) {
    return refuse(`no config at ${configPath}`, [
      "lint-staged is about to be handed this path and will fail too.",
      "Restore the file, or point the pre-commit hook at the right one.",
    ]);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    return refuse(`${configPath} is not valid JSON`, [
      /** @type {Error} */ (error).message,
    ]);
  }

  const extracted = tasksOf(parsed);
  if ("problem" in extracted) {
    return refuse(`${configPath} has a shape this guard cannot read`, [
      extracted.problem,
      "This guard reads JSON configs only, which is what Lisa ships.",
    ]);
  }
  if (extracted.tasks.length === 0) {
    return refuse(`${configPath} declares no tasks`, [
      "lint-staged would run nothing and report success.",
      "Add the tasks back, or stop running lint-staged from the hook.",
    ]);
  }

  const executables = [...new Set(extracted.tasks.map(executableOf))].filter(
    name => name !== ""
  );
  if (executables.length === 0) {
    return refuse(
      `no executable name could be read from the ${extracted.tasks.length} task(s) in ${configPath}`
    );
  }

  process.stdout.write(
    `🔎 lint-staged preflight: probing ${executables.length} tool(s) named by ${configPath}\n`
  );
  const env = probeEnv(cwd);
  const outcomes = await Promise.all(
    executables.map(executable => probe(executable, cwd, env))
  );

  for (const outcome of outcomes) {
    process.stdout.write(
      outcome.started
        ? `   ✅ ${outcome.executable}\n`
        : `   ❌ ${outcome.executable} — could not be started (${outcome.code})\n`
    );
  }

  const broken = outcomes.filter(outcome => !outcome.started);
  if (broken.length > 0) {
    return refuse(
      `${broken.length} of ${outcomes.length} tool(s) cannot be started`,
      [
        ...broken.map(
          outcome => `${outcome.executable}: ${outcome.detail ?? outcome.code}`
        ),
        "",
        "lint-staged spawns these without a shell. A tool that is present but",
        "not executable makes it print [FAILED] and still exit 0, so the scan",
        "would run, report nothing, and block nothing.",
        "",
        "Most often this is an install that skipped postinstall scripts, which",
        "leaves a placeholder where the real binary belongs. Reinstall with",
        "scripts enabled (for example `bun install --force`) and try again.",
      ]
    );
  }

  process.stdout.write(
    `   ${outcomes.length} tool(s) verified runnable; handing off to lint-staged.\n`
  );
  return 0;
};

/**
 * True when `moduleUrl` names the module node was asked to run.
 *
 * Both sides are realpath'd: `import.meta.url` is the real path while `argv[1]`
 * is whatever the caller typed, so through a symlinked checkout, a git
 * worktree, or a `/tmp` path on macOS a raw comparison is false and the body
 * never runs — for a guard, exiting 0 having proved nothing.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the CLI body should run.
 */
export const invokedAsScript = (moduleUrl, argv1 = process.argv[1]) => {
  if (typeof argv1 !== "string" || argv1.length === 0) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
};

if (invokedAsScript(import.meta.url)) {
  run(process.argv.slice(2), process.cwd())
    .then(code => {
      process.exitCode = code;
    })
    .catch(error => {
      process.stderr.write(
        `\n❌ lint-staged preflight crashed: ${/** @type {Error} */ (error).message}\n` +
          "   Nothing was proved. The commit is blocked.\n\n"
      );
      process.exitCode = 1;
    });
}
