/**
 * Direction two: every command the commit and push hooks of a checkout run,
 * and which register entries declare it.
 *
 * Which file to read depends on who owns git hooks, and that is already
 * worked out by the carrier installer's owner detection. This module reads
 * the same file the installer would add its call to:
 *
 * | Who owns hooks | What is read |
 * | --- | --- |
 * | Husky | `.husky/pre-commit`, `.husky/pre-push` |
 * | A folder named by `core.hooksPath`, or git's own hooks folder | That folder's `pre-commit` and `pre-push` |
 * | Lisa's own hook folder | `.lisa/hooks/pre-commit`, `.lisa/hooks/pre-push` |
 * | Lefthook, the pre-commit framework | The manager's committed configuration |
 * | Nobody | Nothing: no hook runs |
 *
 * A hook a Lisa project type ships carries the host's own additions in one
 * place outside its managed block: a file beside the hook named
 * `<hook>.local`, which the managed block reads in. That one file is opened
 * too, because it is the host's part of the hook by Lisa's own design. No
 * other file a hook calls is opened.
 *
 * Nothing found is ever run, and nothing is written.
 * @module controls/reconcile-hooks
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { pathKind } from "./audit-report-file.js";
import { HUSKY_FOLDER, shownPath, type HookFacts } from "./carrier-owner.js";
import {
  CARRIER_HOOKS,
  CARRIER_HOOKS_FOLDER,
  CARRIER_MOMENTS,
  type CarrierMoment,
} from "./carrier-types.js";
import { declaredBy } from "./reconcile-declared.js";
import { readShellHook, type ShellCommand } from "./reconcile-hook-lines.js";
import {
  lefthookCommands,
  preCommitCommands,
} from "./reconcile-manager-commands.js";
import type { HookCommand } from "./reconcile-types.js";
import type { ControlRegister } from "./register-types.js";

/** What the name of a hook's own extension file ends with. */
const EXTENSION_SUFFIX = ".local";

/** The commands the hooks of a checkout run. */
export interface HooksRead {
  /** Every command, commit before push, in the order the files hold them. */
  readonly commands: readonly HookCommand[];
  /** The files that were read, as they are shown. */
  readonly files: readonly string[];
  /** One sentence per file that was there and could not be read. */
  readonly problems: readonly string[];
}

/** What one file contributed. */
interface FileRead {
  readonly file: string | null;
  readonly problem: string | null;
  readonly found: readonly (ShellCommand & {
    readonly moment: CarrierMoment;
  })[];
  /** The lines Lisa wrote in the file, when it is a shell hook. */
  readonly lisaText: string;
}

/** A file that is not there contributes nothing. */
const NOTHING: FileRead = {
  file: null,
  found: [],
  lisaText: "",
  problem: null,
};

/**
 * Read a file's text, or say why it cannot be read.
 * @param absolute - The file
 * @param shown - How the file is named to a person
 * @returns The text, `null` when there is no such file, or the problem
 */
async function textOf(
  absolute: string,
  shown: string
): Promise<{ readonly text: string | null; readonly problem: string | null }> {
  const kind = await pathKind(absolute);
  if (kind === "missing") return { problem: null, text: null };
  if (kind !== "file") {
    return {
      problem: `${shown} is not an ordinary file (it may be a link), so the commands it runs were not read.`,
      text: null,
    };
  }
  try {
    return { problem: null, text: await readFile(absolute, "utf8") };
  } catch (error) {
    return {
      problem: `${shown} could not be opened, so the commands it runs were not read: ${error instanceof Error ? error.message : String(error)}`,
      text: null,
    };
  }
}

/**
 * Read the commands of one shell hook file.
 * @param root - Real path of the repository
 * @param absolute - The hook file
 * @param moment - The moment the hook runs at
 * @returns What the file contributed
 */
async function shellFile(
  root: string,
  absolute: string,
  moment: CarrierMoment
): Promise<FileRead> {
  const shown = shownPath(root, absolute);
  const { problem, text } = await textOf(absolute, shown);
  if (text === null) return { ...NOTHING, problem };
  const read = readShellHook(text);
  return read.problem === null
    ? {
        file: shown,
        found: read.commands.map(command => ({ ...command, moment })),
        lisaText: read.lisaText,
        problem: null,
      }
    : {
        ...NOTHING,
        file: shown,
        problem: `In ${shown}, ${read.problem}. Its commands were not read.`,
      };
}

/**
 * Read one shell hook, and its own extension file when Lisa's block reads
 * one in.
 * @param root - Real path of the repository
 * @param folder - The folder the hook is in
 * @param moment - The moment the hook runs at
 * @returns What the hook and its extension contributed, the hook first
 */
async function shellHook(
  root: string,
  folder: string,
  moment: CarrierMoment
): Promise<readonly FileRead[]> {
  const hook = path.join(folder, CARRIER_HOOKS[moment]);
  const own = await shellFile(root, hook, moment);
  const extension = `${CARRIER_HOOKS[moment]}${EXTENSION_SUFFIX}`;
  return own.lisaText.includes(extension)
    ? [own, await shellFile(root, `${hook}${EXTENSION_SUFFIX}`, moment)]
    : [own];
}

/**
 * Read a hook manager's configuration.
 * @param root - Real path of the repository
 * @param facts - What is known about hooks in this checkout
 * @param file - The manager's configuration file, from the repository root
 * @returns What the configuration contributed
 */
async function managerFile(
  root: string,
  facts: HookFacts,
  file: string
): Promise<readonly FileRead[]> {
  const { problem, text } = await textOf(path.join(root, file), file);
  if (text === null) return [{ ...NOTHING, problem }];
  const read = (
    facts.owner === "lefthook" ? lefthookCommands : preCommitCommands
  )(text);
  return [
    read.problem === null
      ? { file, found: read.commands, lisaText: "", problem: null }
      : {
          ...NOTHING,
          file,
          problem: `${file} could not be read as a hook configuration: ${read.problem}.`,
        },
  ];
}

/**
 * The folder whose shell hooks git runs, or the owner's own.
 * @param root - Real path of the repository
 * @param facts - What is known about hooks in this checkout
 * @returns The folder, or `null` when no shell hook is to be read
 */
function shellFolder(root: string, facts: HookFacts): string | null {
  if (facts.owner === "husky") return path.join(root, HUSKY_FOLDER);
  if (facts.owner === "lisa") return path.join(root, CARRIER_HOOKS_FOLDER);
  return facts.owner === "hooks-path" || facts.owner === "git-hooks"
    ? facts.hooksFolder
    : null;
}

/**
 * Read every file that says what the commit and push hooks run.
 * @param root - Real path of the repository
 * @param facts - What is known about hooks in this checkout
 * @returns What each file contributed, commit before push
 */
async function hookFiles(
  root: string,
  facts: HookFacts
): Promise<readonly FileRead[]> {
  if (facts.managerFile !== null) {
    return managerFile(root, facts, facts.managerFile);
  }
  const folder = shellFolder(root, facts);
  if (folder === null) return [];
  const read = await Promise.all(
    CARRIER_MOMENTS.map(moment => shellHook(root, folder, moment))
  );
  return read.flat();
}

/**
 * Read every command the commit and push hooks of a checkout run.
 * @param root - Real path of the repository
 * @param facts - What is known about hooks in this checkout
 * @param register - The control register the commands are compared with
 * @returns The commands with the entries that declare each, the files read,
 *   and any file that could not be read
 */
export async function readHookCommands(
  root: string,
  facts: HookFacts,
  register: ControlRegister
): Promise<HooksRead> {
  const files = await hookFiles(root, facts);
  const commands = files.flatMap(({ file, found }) =>
    found.map(
      (command): HookCommand => ({
        command: command.command,
        declared_by: declaredBy(register, command.moment, command.words),
        hook: CARRIER_HOOKS[command.moment],
        line: command.line,
        moment: command.moment,
        path: file ?? "",
        through: facts.owner,
      })
    )
  );
  return {
    commands: CARRIER_MOMENTS.flatMap(moment =>
      commands.filter(command => command.moment === moment)
    ),
    files: files.flatMap(({ file }) => (file === null ? [] : [file])),
    problems: files.flatMap(({ problem }) =>
      problem === null ? [] : [problem]
    ),
  };
}
