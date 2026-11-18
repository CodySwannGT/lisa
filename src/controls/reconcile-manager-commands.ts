/**
 * Reading the commands a hook manager is configured to run.
 *
 * Lefthook and the pre-commit framework write git's hook files themselves,
 * from one committed configuration. What a hook runs is therefore in that
 * configuration, and the hook file only starts the manager. So for these two
 * the reconciler reads the configuration and reports what it declares for
 * the commit hook and the push hook:
 *
 * - Lefthook: each command's `run`, each job's `run` or `script` (through
 *   groups), and each entry under `scripts`.
 * - The pre-commit framework: each hook, at the stages it runs at. A hook of
 *   `repo: local` is reported by its `entry`; any other by its `id`, because
 *   what it runs is defined in the repository it comes from, which is not
 *   opened.
 *
 * Nothing here is ever run. The configuration is parsed for what it means
 * and searched as text only to say which line a command is on.
 *
 * What it cannot see: a configuration that another file extends or
 * overrides (`extends`, `remotes`, `lefthook-local.yml`) is read as it is
 * written, without the other file.
 * @module controls/reconcile-manager-commands
 */
import { isJsonObject, type JsonObject } from "../sync/json-path.js";
import {
  CARRIER_HOOKS,
  CARRIER_MOMENTS,
  type CarrierMoment,
} from "./carrier-types.js";
import { blockEnd, keyLine, parseMapping } from "./carrier-yaml-lines.js";
import { commandsInLine, type ShellCommand } from "./reconcile-hook-lines.js";

/** One configured command, and the moment its hook runs at. */
export interface ManagerCommand extends ShellCommand {
  readonly moment: CarrierMoment;
}

/** The configured commands, or why the configuration cannot be read. */
export type ManagerRead =
  | { readonly problem: null; readonly commands: readonly ManagerCommand[] }
  | { readonly problem: string };

/** Reads the commands out of one manager's configuration. */
export type ManagerReader = (text: string) => ManagerRead;

/** What is said of a configuration that does not parse. */
const NOT_READABLE =
  "it is not a YAML or JSON file with settings at its top level, so the commands it configures could not be read";

/** The stage names the pre-commit framework uses for each moment. */
const STAGES: Readonly<Record<CarrierMoment, readonly string[]>> = {
  commit: ["pre-commit", "commit"],
  push: ["pre-push", "push"],
};

/** One thing a configuration runs, before it is read as shell. */
interface Configured {
  /** What is run: a shell snippet, or a script's name. */
  readonly text: string;
  /** Whether the text is shell to be read, or one name to report as it is. */
  readonly shell: boolean;
}

/**
 * Read a list out of a parsed value.
 * @param value - The value
 * @returns The list; empty when the value is not one
 */
function listOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

/**
 * Read a mapping out of a parsed value.
 * @param value - The value
 * @returns The mapping; empty when the value is not one
 */
function mappingOf(value: unknown): JsonObject {
  return isJsonObject(value) ? value : {};
}

/**
 * Find the line some text is first written on.
 * @param lines - The file's lines
 * @param needle - The text; only its first line is looked for
 * @param from - The first line to look at
 * @param to - The line to stop before
 * @returns The line's number counted from 1; the first line looked at when
 *   the text is not found as written
 */
function lineOf(
  lines: readonly string[],
  needle: string,
  from: number,
  to: number
): number {
  const [first = ""] = needle.trim().split("\n");
  const found = lines.findIndex(
    (line, index) => index >= from && index < to && line.includes(first)
  );
  return (found === -1 ? from : found) + 1;
}

/**
 * Everything one Lefthook job runs, through any group it holds.
 * @param job - The parsed job
 * @returns What it runs, in order
 */
function jobRuns(job: unknown): readonly Configured[] {
  const settings = mappingOf(job);
  return [
    ...(typeof settings.run === "string"
      ? [{ shell: true, text: settings.run }]
      : []),
    ...(typeof settings.script === "string"
      ? [{ shell: false, text: settings.script }]
      : []),
    ...listOf(mappingOf(settings.group).jobs).flatMap(inner => jobRuns(inner)),
  ];
}

/**
 * Everything Lefthook runs at one hook.
 * @param settings - The hook's parsed settings
 * @returns What it runs: commands, then jobs, then scripts
 */
function lefthookRuns(settings: JsonObject): readonly Configured[] {
  return [
    ...Object.values(mappingOf(settings.commands)).flatMap(command => {
      const { run } = mappingOf(command);
      return typeof run === "string" ? [{ shell: true, text: run }] : [];
    }),
    ...listOf(settings.jobs).flatMap(job => jobRuns(job)),
    ...Object.keys(mappingOf(settings.scripts)).map(name => ({
      shell: false,
      text: name,
    })),
  ];
}

/**
 * Report what a configuration runs as commands on a line.
 * @param configured - What is run
 * @param line - The line it is written on
 * @param moment - The moment its hook runs at
 * @returns One command per program the text starts; none for Lisa's carrier
 */
function reported(
  configured: Configured,
  line: number,
  moment: CarrierMoment
): readonly ManagerCommand[] {
  const commands = configured.shell
    ? configured.text
        .split("\n")
        .flatMap(piece => commandsInLine(piece.trim(), line))
    : [{ command: configured.text, line, words: [configured.text] }];
  return commands.map(command => ({ ...command, moment }));
}

/**
 * Read the commands a Lefthook configuration runs at commit and at push.
 * @param text - The configuration file's content
 * @returns The commands, commit first, or why the file cannot be read
 */
export const lefthookCommands: ManagerReader = text => {
  const document = parseMapping(text);
  if (document === null) return { problem: NOT_READABLE };
  const lines = text.split(/\r?\n/u);
  return {
    commands: CARRIER_MOMENTS.flatMap(moment => {
      const hook = CARRIER_HOOKS[moment];
      const key = keyLine(lines, hook, 0);
      const [from, to] =
        typeof key === "number"
          ? [key, blockEnd(lines, key, 0)]
          : [0, lines.length];
      return lefthookRuns(mappingOf(document[hook])).flatMap(configured =>
        reported(configured, lineOf(lines, configured.text, from, to), moment)
      );
    }),
    problem: null,
  };
};

/**
 * The moments one pre-commit framework hook runs at.
 * @param hook - The parsed hook
 * @param defaults - The configuration's `default_stages`, when it has any
 * @returns The moments; both when nothing names a stage
 */
function momentsOf(
  hook: JsonObject,
  defaults: unknown
): readonly CarrierMoment[] {
  const stages = Array.isArray(hook.stages) ? hook.stages : defaults;
  return Array.isArray(stages)
    ? CARRIER_MOMENTS.filter(moment =>
        STAGES[moment].some(stage =>
          (stages as readonly unknown[]).includes(stage)
        )
      )
    : CARRIER_MOMENTS;
}

/** One hook of a pre-commit framework configuration, and where it is. */
interface FrameworkHook {
  readonly hook: JsonObject;
  /** Whether it is defined in this repository (`repo: local`). */
  readonly local: boolean;
  /** The line its `id` is on, counted from 1. */
  readonly line: number;
}

/**
 * Find every hook of a configuration, with the line its id is written on.
 * @param repos - The parsed list of hook sources
 * @param lines - The file's lines
 * @returns The hooks in the order the file lists them
 */
function frameworkHooks(
  repos: readonly unknown[],
  lines: readonly string[]
): readonly FrameworkHook[] {
  const listed = repos.flatMap(repo => {
    const source = mappingOf(repo);
    return listOf(source.hooks).map(hook => ({
      hook: mappingOf(hook),
      local: source.repo === "local",
    }));
  });
  return listed.reduce<readonly FrameworkHook[]>((found, each) => {
    const after = found.at(-1)?.line ?? 0;
    const line = lineOf(
      lines,
      `id: ${String(each.hook.id)}`,
      after,
      lines.length
    );
    return [...found, { ...each, line }];
  }, []);
}

/**
 * Read the hooks a pre-commit framework configuration runs at commit and at
 * push.
 * @param text - The configuration file's content
 * @returns The hooks as commands, in file order, or why the file cannot be
 *   read
 */
export const preCommitCommands: ManagerReader = text => {
  const document = parseMapping(text);
  if (document === null) return { problem: NOT_READABLE };
  if (document.repos !== undefined && !Array.isArray(document.repos)) {
    return {
      problem: `its "repos" entry is not a list of hook sources, so the hooks it configures could not be read`,
    };
  }
  const lines = text.split(/\r?\n/u);
  return {
    commands: frameworkHooks(listOf(document.repos), lines).flatMap(
      ({ hook, line, local }) => {
        const named =
          local && typeof hook.entry === "string" ? hook.entry : hook.id;
        const run = [named, ...listOf(hook.args)]
          .filter(part => typeof part === "string" || typeof part === "number")
          .join(" ");
        return momentsOf(hook, document.default_stages).flatMap(moment =>
          reported({ shell: true, text: run }, line, moment)
        );
      }
    ),
    problem: null,
  };
};
