/**
 * Which file says what a check's command runs, when the command goes
 * through a task runner.
 *
 * A check is declared as a command: one program and its arguments. Often
 * that program is not the check itself. `npm run lint` runs whatever the
 * `lint` script in `package.json` says, and `make lint` whatever the `lint`
 * target in the Makefile says. A proof's change that edits that script or
 * target changes the check as surely as one that edits the declaration: the
 * script can be swapped for one that prints the failure text and exits 1,
 * and a check that enforces nothing then reads as proved. So such a change
 * is not a proof's change (`./proof-change-rule.ts`).
 *
 * Everything here is decided by reading the argument list and, for a
 * `package.json`, the file before and after the change. Nothing is started.
 *
 * ## The runners that are recognised
 *
 * | The command starts | The file that says what runs | What counts as changing it |
 * | --- | --- | --- |
 * | `npm`, `pnpm`, `yarn`, `bun` (any subcommand), `node --run` | any `package.json` in the repository | its `scripts` differ, or the file is added or removed |
 * | `make`, `gmake` | `Makefile`, `makefile`, `GNUmakefile`, any `*.mk`, and the file named by `-f`, `--file` or `--makefile` | any change to the file |
 * | `just` | `justfile`, `.justfile` (in any letter case), any `*.just`, and the file named by `-f` or `--justfile` | any change to the file |
 *
 * A runner is also recognised behind the three ways a command is commonly
 * wrapped: `env` with its options and `NAME=value` settings in front,
 * `corepack` in front, and a shell (`sh`, `bash`, `dash`, `zsh`, `ksh`,
 * `ash`) given its script with `-c`. In a shell's script every word is
 * looked at, so a script that merely mentions `make` is treated as running
 * it. That errs toward refusing a change, never toward letting one through.
 *
 * Any `package.json` counts, not only the one nearest the check's folder: a
 * package manager can be pointed at another one by an option or a workspace
 * setting, and reading the argument list cannot always say which.
 *
 * ## The program itself
 *
 * When the command's program is given as a path into the repository
 * (`./scripts/lint.sh`, `bin/check`), that file is the check, and a change
 * that edits it changes the check. {@link startedProgram} names it.
 *
 * ## What is not covered, and why
 *
 * - **The checked tool's own configuration**: a linter's rule file, a test
 *   runner's settings. A change that edits one is, for all that can be read
 *   from an argument list, a change the tool is there to judge.
 * - **A file a script or a target goes on to start**: `"lint": "node
 *   tools/lint.js"` is covered as far as the script's own text, and
 *   `tools/lint.js` is not.
 * - **A file handed to an interpreter as an argument** (`node check.mjs`,
 *   `sh lint.sh`, `python -m …`). An argument list does not say whether such
 *   a file is the program or the thing the program is asked to look at, and
 *   a proof often has to change the latter.
 * - **Any other task runner.** Only the ones in the table are recognised.
 * @module controls/proof-task-runners
 */
import path from "node:path";

import { isJsonObject } from "../sync/json-path.js";
import { canonicalText } from "./canonical-json.js";

/** The kind of a package manager, which runs a manifest's scripts. */
const PACKAGE_SCRIPTS = "package-scripts";

/** The kinds of task runner a command can go through. */
export const TASK_RUNNER_KINDS = [PACKAGE_SCRIPTS, "make", "just"] as const;

/** One kind of task runner. */
export type TaskRunnerKind = (typeof TASK_RUNNER_KINDS)[number];

/** The programs of each kind, by the name they are started under. */
export const TASK_RUNNER_PROGRAMS: Readonly<
  Record<TaskRunnerKind, readonly string[]>
> = {
  [PACKAGE_SCRIPTS]: ["npm", "pnpm", "yarn", "bun"],
  make: ["make", "gmake"],
  just: ["just"],
};

/** The shells whose `-c` script is read for a runner's name. */
export const SCRIPT_SHELLS = ["sh", "bash", "dash", "zsh", "ksh", "ash"];

/** The file every package manager reads its scripts from. */
const PACKAGE_MANIFEST = "package.json";

/** The names `make` looks for when it is given none. */
const MAKEFILE_NAMES = ["GNUmakefile", "makefile", "Makefile"];

/** The names `just` looks for, in lower case; it ignores letter case. */
const JUSTFILE_NAMES = ["justfile", ".justfile"];

/** The options that name the file a runner reads, per kind. */
const FILE_OPTIONS: Readonly<Record<TaskRunnerKind, readonly string[]>> = {
  [PACKAGE_SCRIPTS]: [],
  make: ["-f", "--file", "--makefile"],
  just: ["-f", "--justfile"],
};

/** The options of `env` that take the next argument as their value. */
const ENV_VALUE_OPTIONS = ["-u", "--unset", "-C", "--chdir"];

/** The options of `env` whose value is a command line written as one text. */
const ENV_SPLIT_OPTIONS = ["-S", "--split-string"];

/** A `NAME=value` setting in front of a command. */
const SETTING = /^[A-Za-z_]\w*=/u;

/** The letters of a group of one-letter options. */
const OPTION_LETTERS = /^[A-Za-z]+$/u;

/** What ends a program's file name on Windows. */
const PROGRAM_SUFFIX = /\.(?:exe|cmd|bat|ps1)$/u;

/** What a file held before a change and after it; `null` where it is absent. */
export interface ManifestSides {
  readonly before: string | null;
  readonly after: string | null;
}

/** A runner's file that a change edits. */
export interface RunnerManifestChange {
  /** The file, from the repository root. */
  readonly file: string;
  /** The kind of runner whose file it is. */
  readonly runner: TaskRunnerKind;
}

/**
 * The name a program is started under: no folder, no Windows suffix.
 * @param program - The program as the command writes it
 * @returns The name, in lower case
 */
function programName(program: string): string {
  return path.posix
    .basename(program.replaceAll("\\", "/"))
    .toLowerCase()
    .replace(PROGRAM_SUFFIX, "");
}

/**
 * The kinds of runner a program's name belongs to.
 * @param name - The name a program is started under
 * @returns The kinds; at most one
 */
function kindsOfName(name: string): readonly TaskRunnerKind[] {
  return TASK_RUNNER_KINDS.filter(kind =>
    TASK_RUNNER_PROGRAMS[kind].includes(name)
  );
}

/**
 * The kinds of runner a piece of shell text mentions.
 * @param text - A shell's script, or a command line written as one text
 * @returns Each kind whose program is a word of the text
 */
function kindsInText(text: string): readonly TaskRunnerKind[] {
  const names = new Set(
    text.split(/[^\w./\\-]+/u).map(word => programName(word))
  );
  return TASK_RUNNER_KINDS.filter(kind =>
    TASK_RUNNER_PROGRAMS[kind].some(program => names.has(program))
  );
}

/**
 * What follows `env` once its own options and settings are passed over.
 * @param rest - The arguments after `env`
 * @returns The command `env` starts, and each command line it was given as
 *   one text
 */
function afterEnv(rest: readonly string[]): {
  readonly command: readonly string[];
  readonly texts: readonly string[];
} {
  const [first, second, ...others] = rest;
  if (first === undefined) return { command: [], texts: [] };
  if (first === "--") {
    return { command: rest.slice(1), texts: [] };
  }
  if (ENV_SPLIT_OPTIONS.includes(first)) {
    const inner = afterEnv(others);
    return {
      command: inner.command,
      texts: [...(second === undefined ? [] : [second]), ...inner.texts],
    };
  }
  if (ENV_VALUE_OPTIONS.includes(first)) return afterEnv(others);
  return first.startsWith("-") || SETTING.test(first)
    ? afterEnv(rest.slice(1))
    : { command: rest, texts: [] };
}

/**
 * Tell whether an argument is a group of one-letter options that holds `c`,
 * the option a shell takes its script with: `-c`, `-ec`, `-lc`.
 * @param argument - One argument of a shell
 * @returns Whether the next argument is the script
 */
function takesScript(argument: string): boolean {
  const letters = argument.slice(1);
  return (
    argument.startsWith("-") &&
    OPTION_LETTERS.test(letters) &&
    letters.includes("c")
  );
}

/**
 * The script a shell was given with `-c`.
 * @param rest - The arguments after the shell
 * @returns The script, or `null` when the shell was given none that way
 */
function shellScript(rest: readonly string[]): string | null {
  const at = rest.findIndex(argument => takesScript(argument));
  return at < 0 ? null : (rest[at + 1] ?? null);
}

/**
 * The command behind the wrappers that only start another command.
 * @param argv - A command, the program first
 * @returns The command that is started in the end, and every piece of shell
 *   text met on the way
 */
function unwrapped(argv: readonly string[]): {
  readonly command: readonly string[];
  readonly texts: readonly string[];
} {
  const [program, ...rest] = argv;
  if (program === undefined) return { command: [], texts: [] };
  const name = programName(program);
  if (name === "env") {
    const inner = afterEnv(rest);
    const deeper = unwrapped(inner.command);
    return {
      command: deeper.command,
      texts: [...inner.texts, ...deeper.texts],
    };
  }
  if (name === "corepack") {
    // Corepack's own options come before the package manager's name.
    const at = rest.findIndex(argument => !argument.startsWith("-"));
    return at < 0 ? { command: [], texts: [] } : unwrapped(rest.slice(at));
  }
  const script = SCRIPT_SHELLS.includes(name) ? shellScript(rest) : null;
  return { command: argv, texts: script === null ? [] : [script] };
}

/**
 * Name the kinds of task runner a command goes through.
 * @param argv - The command, the program first
 * @returns Each kind, once; empty when the command goes through none
 */
export function taskRunnersOf(
  argv: readonly string[]
): readonly TaskRunnerKind[] {
  const { command, texts } = unwrapped(argv);
  const [program, ...rest] = command;
  const name = program === undefined ? "" : programName(program);
  const runsScript =
    name === "node" &&
    rest.some(
      argument => argument === "--run" || argument.startsWith("--run=")
    );
  const found = new Set<TaskRunnerKind>([
    ...kindsOfName(name),
    ...(runsScript ? ([PACKAGE_SCRIPTS] as const) : []),
    ...texts.flatMap(text => kindsInText(text)),
  ]);
  return TASK_RUNNER_KINDS.filter(kind => found.has(kind));
}

/**
 * Name the file a command starts, when its program is written as a path
 * into the repository.
 * @param argv - The command, the program first
 * @param scope - The folder the command is started in, from the root
 * @returns The file, from the repository root; `null` when the program is
 *   looked up by name, or the path leads out of the repository
 */
export function startedProgram(
  argv: readonly string[],
  scope: string
): string | null {
  const [program] = unwrapped(argv).command;
  if (program === undefined || !program.includes("/")) return null;
  if (path.posix.isAbsolute(program)) return null;
  const file = path.posix.normalize(path.posix.join(scope, program));
  return file.startsWith("..") ? null : file;
}

/**
 * The files a command names with one of a runner's file options.
 * @param argv - The command, the program first
 * @param kind - The kind of runner
 * @param scope - The folder the command is started in, from the root
 * @returns Each named file, from the repository root
 */
function namedFiles(
  argv: readonly string[],
  kind: TaskRunnerKind,
  scope: string
): readonly string[] {
  const options = FILE_OPTIONS[kind];
  const { command } = unwrapped(argv);
  return command.flatMap((argument, index) => {
    const joined = options
      .filter(option => option.startsWith("--"))
      .find(option => argument.startsWith(`${option}=`));
    const value =
      joined === undefined
        ? options.includes(argument)
          ? command[index + 1]
          : undefined
        : argument.slice(joined.length + 1);
    return value === undefined || path.posix.isAbsolute(value)
      ? []
      : [path.posix.normalize(path.posix.join(scope, value))];
  });
}

/**
 * Tell whether a path is a file one kind of runner reads what to run from.
 * @param kind - The kind of runner
 * @param file - The path, from the repository root
 * @param named - The files the command names with the runner's file option
 * @returns Whether it is
 */
function isManifest(
  kind: TaskRunnerKind,
  file: string,
  named: readonly string[]
): boolean {
  const name = path.posix.basename(file);
  if (kind === PACKAGE_SCRIPTS) return name === PACKAGE_MANIFEST;
  if (named.includes(file)) return true;
  return kind === "make"
    ? MAKEFILE_NAMES.includes(name) || name.endsWith(".mk")
    : JUSTFILE_NAMES.includes(name.toLowerCase()) || name.endsWith(".just");
}

/**
 * The scripts a `package.json` defines, as text two files can be compared
 * by.
 * @param text - The file's content
 * @returns The scripts in canonical form; the whole text when the file is
 *   not a JSON object, so that any change to it shows
 */
function scriptsOf(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isJsonObject(parsed)
      ? canonicalText({ scripts: parsed.scripts ?? null })
      : text;
  } catch {
    return text;
  }
}

/**
 * Tell whether a change to one of a runner's files changes what it runs.
 * @param kind - The kind of runner
 * @param sides - What the file held before the change and after it
 * @returns Whether it does
 */
function changesWhatRuns(kind: TaskRunnerKind, sides: ManifestSides): boolean {
  const { before, after } = sides;
  // A `package.json` that appears or goes changes which one is nearest.
  if (kind !== PACKAGE_SCRIPTS || before === null || after === null) {
    return true;
  }
  return scriptsOf(before) !== scriptsOf(after);
}

/**
 * Find the first file of a change that says what a check's command runs.
 * @param subject - The command and the change
 * @param subject.argv - The command, the program first
 * @param subject.scope - The folder the command is started in, from the root
 * @param subject.paths - The paths the change touches, from the root
 * @param subject.read - Reads one of those files before and after the change
 * @returns The file and the kind of runner, or `null` when the command goes
 *   through no runner or the change leaves what it runs alone
 */
export function runnerManifestChange(subject: {
  readonly argv: readonly string[];
  readonly scope: string;
  readonly paths: readonly string[];
  readonly read: (file: string) => ManifestSides;
}): RunnerManifestChange | null {
  const { argv, scope, paths, read } = subject;
  const found = taskRunnersOf(argv).flatMap(runner => {
    const named = namedFiles(argv, runner, scope);
    return paths
      .filter(file => isManifest(runner, file, named))
      .filter(file => changesWhatRuns(runner, read(file)))
      .map(file => ({ file, runner }));
  });
  return found[0] ?? null;
}
