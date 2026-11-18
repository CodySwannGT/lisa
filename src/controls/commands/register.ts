/**
 * `lisa controls register [path] [--check]`: write the control register from
 * the `gates` declaration, or check that the committed one still matches it.
 *
 * The register at `.lisa/controls/register.json` is the one file an operator,
 * an auditor or another tool reads to see what governs a repository. It is
 * generated, never edited: the `gates` block of `.lisa.config.json` is what a
 * person or an agent writes, and this command turns it into the register.
 *
 * Without `--check` it writes the file, and writes nothing when the file is
 * already what it would write. With `--check` it writes nothing at all: it
 * generates the register in memory, compares it with the committed file byte
 * for byte, and names every entry that differs. That is the check that makes
 * a hand edit, or a declaration changed without regenerating, fail.
 *
 * It works in a repository where Lisa was never applied. The requirements and
 * the gate registry come from the Lisa package the command runs from; nothing
 * is read from the host but `.lisa.config.json`, `package.json` when there is
 * one, and the register itself.
 *
 * One declaration makes it read one more file. When a gate's pull-request
 * moment names an executor on a platform Lisa ships no pull-request file for,
 * the entries it runs read `unproved` until `.lisa/controls/evidence.json`
 * holds both halves of their proof, each held, and the command says which
 * entries those are. The register is then generated from the declaration and
 * that file
 * together, in both modes, so `--check` fails exactly when one of the two
 * changed since the register was written. The clock is never read.
 * @module controls/commands/register
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Command } from "commander";

import { pathKind, resolveRepositoryRoot } from "../audit-report-file.js";
import { GATES_DECLARATION_PATH } from "../gates-declaration.js";
import { unprovedNote } from "../pull-request-executor.js";
import { controlRegisterDrift } from "../register-drift.js";
import {
  generateControlRegister,
  type ControlRegisterGeneration,
} from "../register.js";
import {
  CONTROL_REGISTER_PATH,
  type ControlRegister,
} from "../register-types.js";

/** The subcommand's name under `lisa controls`. */
export const REGISTER_COMMAND = "register";

/** The folder the register lives in, from the repository root. */
const REGISTER_FOLDER = path.posix.dirname(CONTROL_REGISTER_PATH);

/** What the operator does about any drift, said once. */
const HOW_TO_FIX = `The register is generated, so do not edit it by hand. If a rule should change, change the gates block in ${GATES_DECLARATION_PATH}. Then run "lisa controls register" to write the file again.`;

/** The command's options. */
export interface RegisterOptions {
  /** Compare the committed register instead of writing it. */
  readonly check?: boolean;
}

/** What the command needs from outside, each replaceable in a test. */
export interface RegisterDependencies {
  /** The directory the path argument is resolved from. */
  readonly cwd?: string;
  /** Where the pass line goes. */
  readonly stdout?: (line: string) => void;
  /** Where problems go, one per call. */
  readonly stderr?: (line: string) => void;
  /** Generates the register of a repository. */
  readonly generate?: (root: string) => Promise<ControlRegisterGeneration>;
}

/**
 * Count things in words.
 * @param count - How many
 * @param noun - What they are, singular
 * @param plural - The plural, when adding an `s` is not it
 * @returns For example `1 gate` or `3 entries`
 */
function counted(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

/**
 * Say how much a register holds.
 * @param register - The register
 * @returns For example `3 entries from 2 gates`
 */
function contents(register: ControlRegister): string {
  const gates = new Set(register.entries.map(entry => entry.gate)).size;
  return `${counted(register.entries.length, "entry", "entries")} from ${counted(gates, "gate")}`;
}

/**
 * Find anything on the way to the register that is not an ordinary folder.
 *
 * A link there could lead outside the repository, and this command reads and
 * writes nowhere else.
 * @param root - Real path of the repository
 * @returns The one-line problem, or `null` when the way is clear
 */
async function folderProblem(root: string): Promise<string | null> {
  const folders = REGISTER_FOLDER.split("/").map((_, index, segments) =>
    segments.slice(0, index + 1).join("/")
  );
  const kinds = await Promise.all(
    folders.map(folder => pathKind(path.join(root, folder)))
  );
  const blocked = folders.find(
    (_, index) => kinds[index] !== "missing" && kinds[index] !== "folder"
  );
  return blocked === undefined
    ? null
    : `${blocked} is not an ordinary folder (it may be a link), so nothing in it was read or written. Replace it with an ordinary folder.`;
}

/**
 * Read the committed register.
 * @param root - Real path of the repository
 * @returns Its content, or the one-line reason there is none to compare
 */
async function readCommitted(
  root: string
): Promise<
  | { readonly problem: null; readonly text: string }
  | { readonly problem: string }
> {
  const blocked = await folderProblem(root);
  if (blocked !== null) return { problem: blocked };
  const file = path.join(root, CONTROL_REGISTER_PATH);
  const kind = await pathKind(file);
  if (kind === "missing") {
    return {
      problem: `No control register was found at ${CONTROL_REGISTER_PATH}. Run "lisa controls register" to write it.`,
    };
  }
  return kind === "file"
    ? { problem: null, text: await readFile(file, "utf8") }
    : {
        problem: `${CONTROL_REGISTER_PATH} is not an ordinary file (it may be a link), so it was not read.`,
      };
}

/**
 * Write the register, unless it is already what would be written.
 * @param root - Real path of the repository
 * @param text - The file content to write
 * @returns Whether the file was written, or the one-line reason it was not
 */
async function writeRegister(
  root: string,
  text: string
): Promise<
  | { readonly problem: null; readonly wrote: boolean }
  | { readonly problem: string }
> {
  const blocked = await folderProblem(root);
  if (blocked !== null) return { problem: blocked };
  const file = path.join(root, CONTROL_REGISTER_PATH);
  const kind = await pathKind(file);
  if (kind !== "missing" && kind !== "file") {
    return {
      problem: `${CONTROL_REGISTER_PATH} is not an ordinary file (it may be a link), so nothing was written to it. Remove it, then run this again.`,
    };
  }
  if (kind === "file" && (await readFile(file, "utf8")) === text) {
    return { problem: null, wrote: false };
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return { problem: null, wrote: true };
}

/**
 * Compare the committed register with the generated one.
 * @param root - Real path of the repository
 * @param register - The register the declaration produces
 * @returns One line per difference; empty when the file is up to date
 */
async function differences(
  root: string,
  register: ControlRegister
): Promise<readonly string[]> {
  const committed = await readCommitted(root);
  return committed.problem === null
    ? controlRegisterDrift(committed.text, register)
    : [committed.problem];
}

/**
 * Write or check the control register of one repository.
 * @param targetPath - The repository; the working directory when left out
 * @param options - Whether to check instead of write
 * @param dependencies - Replaceable collaborators
 * @returns The exit code: 0 when the register is written or matches, 1 when
 *   the declaration is refused, the file cannot be used, or it has drifted
 */
export async function runRegister(
  targetPath: string | undefined,
  options: RegisterOptions = {},
  dependencies: RegisterDependencies = {}
): Promise<number> {
  const stdout =
    dependencies.stdout ?? (line => process.stdout.write(`${line}\n`));
  const stderr =
    dependencies.stderr ?? (line => process.stderr.write(`${line}\n`));
  const name = options.check === true ? "register --check" : "register";
  const fail = (problems: readonly string[], summary: string): number => {
    problems.forEach(problem => {
      stderr(problem.replaceAll(/\s+/gu, " "));
    });
    stderr(`${name}: FAIL. ${summary}`);
    return 1;
  };

  const named = path.resolve(
    dependencies.cwd ?? process.cwd(),
    targetPath ?? "."
  );
  const root = await resolveRepositoryRoot(named);
  if (root === null) {
    return fail(
      [`${targetPath ?? named} is not a folder.`],
      "Give the path of the repository whose register to generate"
    );
  }
  const generated = await (dependencies.generate ?? generateControlRegister)(
    root
  );
  if (generated.problems !== null) {
    return fail(
      generated.problems,
      `${counted(generated.problems.length, "problem")} with the gates declaration in ${GATES_DECLARATION_PATH}, so no register could be generated. Fix the declaration, then run this again`
    );
  }
  const unproved = unprovedNote(generated.register);
  const noteUnproved = (): void => {
    if (unproved !== null) stdout(`${name}: ${unproved}`);
  };
  if (options.check === true) {
    const drift = await differences(root, generated.register);
    if (drift.length > 0) {
      return fail(
        drift,
        `${counted(drift.length, "difference")} between ${CONTROL_REGISTER_PATH} and the gates declaration in ${GATES_DECLARATION_PATH}. ${HOW_TO_FIX}`
      );
    }
    noteUnproved();
    stdout(
      `${name}: PASS. ${CONTROL_REGISTER_PATH} matches the gates declaration (${contents(generated.register)})`
    );
    return 0;
  }
  const written = await writeRegister(root, generated.text);
  if (written.problem !== null) {
    return fail([written.problem], `${CONTROL_REGISTER_PATH} was not written`);
  }
  const outcome = written.wrote
    ? `wrote ${CONTROL_REGISTER_PATH}`
    : `${CONTROL_REGISTER_PATH} is already up to date`;
  noteUnproved();
  stdout(`${name}: PASS. ${contents(generated.register)}; ${outcome}`);
  return 0;
}

/** The collaborator the registration needs, replaceable in a test. */
export interface RegisterCommandDependencies {
  readonly runRegister: (
    targetPath: string | undefined,
    options: RegisterOptions
  ) => Promise<number>;
}

/**
 * Register `register` under the `lisa controls` group.
 * @param group - The `controls` command
 * @param dependencies - Replaceable collaborators
 */
export function registerRegister(
  group: Command,
  dependencies: RegisterCommandDependencies = {
    runRegister: (targetPath, options) => runRegister(targetPath, options),
  }
): void {
  group
    .command(REGISTER_COMMAND)
    .description(
      `Write the control register at ${CONTROL_REGISTER_PATH} from the gates declaration in ${GATES_DECLARATION_PATH}`
    )
    .argument("[path]", "Project path (default: current directory)")
    .option(
      "--check",
      "Write nothing: fail when the committed register differs from what the gates declaration produces"
    )
    .action(
      async (targetPath: string | undefined, options: RegisterOptions) => {
        const code = await dependencies.runRegister(targetPath, {
          check: options.check === true,
        });
        if (code !== 0) process.exitCode = code;
      }
    );
}
