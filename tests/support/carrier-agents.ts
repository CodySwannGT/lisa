/**
 * Installing edit-time carriers in a fixture repository and then doing what a
 * coding agent does after it writes a file: starting the hook the repository
 * registers for it, with the event on standard input
 * (CodySwannGT/lisa#4990).
 *
 * Nothing here knows how Lisa wrote the registration. Each agent's command is
 * read back out of the file that agent reads, the way the agent finds it, and
 * started the way the agent starts it. So a suite built on this proves the
 * whole path: the registration, the carrier, the gate runner and the declared
 * check.
 * @module tests/support/carrier-agents
 */
import { type SpawnSyncReturns } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { CarrierPoint } from "../../src/controls/carrier-types.js";
import { evidenceAt, type GatesBlock } from "../helpers/control-register.js";
import { handOffEvent } from "./agent-event-handoff.js";
import {
  type CarrierCommandRun,
  CHECKED_FILE,
  installCarriers,
  LINT_SHAPE,
  operatorEnv,
  PLANTED,
} from "./carrier-install.js";
import {
  fNoneWithConfig,
  NODE,
  type NoManifestRepository,
} from "./no-manifest-run.js";

/** The moment a coding agent's edit-time hook carries. */
export const POST_TOOL = "post-tool";

/** The gate the suites declare at that moment. */
export const EDIT_GATE = "code-style";

/**
 * A stand-in for a linter. It records that it ran, and which file it was
 * told was written, in a file outside the repository; and it fails, the way a
 * linter reports it, when the checked file holds the planted marker.
 */
const CHECK = [
  'const fs = require("node:fs");',
  'fs.appendFileSync(process.argv[1], "ran " + (process.env.LISA_EDITED_FILE ?? "") + "\\n");',
  `if (fs.readFileSync("${CHECKED_FILE}", "utf8").includes("${PLANTED}")) {`,
  `  console.log("${LINT_SHAPE}.");`,
  "  process.exit(1);",
  "}",
].join("\n");

/**
 * A gates block with one check declared for the moment after a file write.
 * @param ran - The file the check records each run in
 * @param entry - The gate's `post-tool` entry
 * @returns The `gates` block
 */
export function editGates(
  ran: string,
  entry: unknown = "required"
): GatesBlock {
  return {
    [EDIT_GATE]: {
      [POST_TOOL]: entry,
      parts: [
        {
          scope: ".",
          command: [NODE, "-e", CHECK, ran],
          proof: { failure_shape: [LINT_SHAPE] },
          evidence: evidenceAt(CHECKED_FILE),
        },
      ],
    },
  };
}

/** F-none with a check declared for the moment after a file write. */
export interface EditRepository {
  /** The repository and a folder outside it. */
  readonly repository: NoManifestRepository;
  /** The repository's root. */
  readonly root: string;
  /** The file the check appends a line to each time it runs. */
  readonly ran: string;
}

/**
 * Build F-none with the given `.lisa.config.json`.
 * @param config - Builds the file's content from where the check records;
 *   `null` to commit no such file
 * @returns The repository and where its check records that it ran
 */
export function editRepository(
  config: ((ran: string) => string) | null = ran =>
    `${JSON.stringify({ gates: editGates(ran) }, null, 2)}\n`
): EditRepository {
  const outside = mkdtempSync(path.join(tmpdir(), "lisa-edit-ran-"));
  const ran = path.join(outside, "edit-ran.txt");
  const repository = fNoneWithConfig(config === null ? null : config(ran));
  return {
    ran,
    repository: {
      ...repository,
      cleanup: () => {
        repository.cleanup();
        rmSync(outside, { force: true, recursive: true });
      },
    },
    root: repository.fixture.repoPath,
  };
}

/**
 * What the check recorded: one item per run, holding the file it was told
 * was written.
 * @param ran - The file the check appends to
 * @returns The file named on each run; an empty string when none was
 */
export function editRuns(ran: string): readonly string[] {
  try {
    return readFileSync(ran, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(line => line.slice("ran ".length));
  } catch {
    return [];
  }
}

/**
 * Write the checked file the way an agent's tool would.
 * @param root - The repository
 * @param line - The line the file gains
 * @returns The file's path from the repository root
 */
export function agentWrites(root: string, line: string): string {
  const file = path.join(root, CHECKED_FILE);
  writeFileSync(file, `${readFileSync(file, "utf8")}${line}\n`);
  return CHECKED_FILE;
}

/**
 * Read a JSON file of a repository.
 * @param root - The repository
 * @param relative - The file, from the repository root
 * @returns The parsed content
 */
export function readJson(root: string, relative: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relative), "utf8")) as unknown;
}

/**
 * Read a file of a repository as text.
 * @param root - The repository
 * @param relative - The file, from the repository root
 * @returns Its content
 */
export function readText(root: string, relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

/**
 * Write a file of a repository, making its folder first.
 * @param root - The repository
 * @param relative - The file, from the repository root
 * @param content - What it holds
 */
export function placeFile(
  root: string,
  relative: string,
  content: string
): void {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), content);
}

/**
 * Run `lisa controls install-carriers` for agents named on the flag.
 * @param root - The repository
 * @param names - The agents
 * @param check - Whether to write nothing
 * @returns The finished run
 */
export function installForAgents(
  root: string,
  names: readonly string[],
  check = false
): Promise<CarrierCommandRun> {
  return installCarriers(root, { agents: { from: "named", names }, check });
}

/**
 * The enforcement point of one agent in a result.
 * @param run - The finished run
 * @param agent - The agent
 * @returns The point
 */
export function agentPoint(
  run: CarrierCommandRun,
  agent: string
): CarrierPoint {
  const found = run.result?.enforcement_points.find(
    point => point.agent === agent
  );
  if (found === undefined) throw new Error(`no point for ${agent}`);
  return found;
}

/** An agent whose hook is a shell command, and how the agent starts it. */
export interface ShellAgent {
  /** The agent, by the name the harness setting uses. */
  readonly agent: string;
  /** The file the agent reads its hooks from, from the repository root. */
  readonly file: string;
  /** Finds the commands registered for the hook after a tool, in order. */
  readonly commands: (document: unknown) => readonly string[];
  /** The variable the agent sets to the repository, when it sets one. */
  readonly rootVariable: string | null;
  /** The event the agent hands its hook after writing a file. */
  readonly writeEvent: (root: string, file: string) => unknown;
}

/**
 * Walk into a parsed JSON document.
 * @param document - The document
 * @param keys - The keys to follow
 * @returns What is there, or `undefined`
 */
function at(document: unknown, keys: readonly string[]): unknown {
  return keys.reduce<unknown>(
    (value, key) =>
      value !== null && typeof value === "object"
        ? (value as Readonly<Record<string, unknown>>)[key]
        : undefined,
    document
  );
}

/**
 * The commands of a list of hooks that nests handlers under a matcher.
 * @param list - The list of hooks for the event
 * @returns Every handler's command, in order
 */
function nestedCommands(list: unknown): readonly string[] {
  return (Array.isArray(list) ? list : []).flatMap(entry =>
    (Array.isArray(at(entry, ["hooks"]))
      ? (at(entry, ["hooks"]) as readonly unknown[])
      : []
    ).flatMap(handler => {
      const command = at(handler, ["command"]);
      return typeof command === "string" ? [command] : [];
    })
  );
}

/**
 * The commands of a list of hooks written one object per hook.
 * @param list - The list of hooks for the event
 * @param key - The key that holds the command
 * @returns Every hook's command, in order
 */
function flatCommands(list: unknown, key: string): readonly string[] {
  return (Array.isArray(list) ? list : []).flatMap(entry => {
    const command = at(entry, [key]);
    return typeof command === "string" ? [command] : [];
  });
}

/** Every agent whose hook is a shell command registered in a file. */
export const SHELL_AGENTS: readonly ShellAgent[] = [
  {
    agent: "claude",
    commands: document =>
      nestedCommands(at(document, ["hooks", "PostToolUse"])),
    file: ".claude/settings.json",
    rootVariable: "CLAUDE_PROJECT_DIR",
    writeEvent: (root, file) => ({
      cwd: root,
      hook_event_name: "PostToolUse",
      tool_input: { content: "…", file_path: path.join(root, file) },
      tool_name: "Write",
    }),
  },
  {
    agent: "codex",
    commands: document =>
      nestedCommands(at(document, ["hooks", "PostToolUse"])),
    file: ".codex/hooks.json",
    rootVariable: null,
    writeEvent: (root, file) => ({
      cwd: root,
      hook_event_name: "PostToolUse",
      tool_input: {
        command: `*** Begin Patch\n*** Update File: ${file}\n@@\n+…\n*** End Patch`,
      },
      tool_name: "apply_patch",
    }),
  },
  {
    agent: "cursor",
    commands: document =>
      flatCommands(at(document, ["hooks", "postToolUse"]), "command"),
    file: ".cursor/hooks.json",
    rootVariable: "CURSOR_PROJECT_DIR",
    writeEvent: (_root, file) => ({
      hook_event_name: "postToolUse",
      tool_input: { file_path: file },
      tool_name: "Write",
      tool_output: "{}",
    }),
  },
  {
    agent: "copilot",
    commands: document =>
      flatCommands(at(document, ["hooks", "postToolUse"]), "bash"),
    file: ".github/hooks/lisa-controls.json",
    rootVariable: null,
    writeEvent: (root, file) => ({
      cwd: root,
      timestamp: 1_700_000_000_000,
      toolArgs: JSON.stringify({ path: file }),
      toolName: "edit",
      toolResult: { resultType: "success" },
    }),
  },
  {
    agent: "devin",
    commands: document => nestedCommands(at(document, ["PostToolUse"])),
    file: ".devin/hooks.v1.json",
    rootVariable: "DEVIN_PROJECT_DIR",
    writeEvent: (root, file) => ({
      tool_input: { file_path: path.join(root, file) },
      tool_name: "write",
    }),
  },
];

/**
 * Find a shell agent by name.
 * @param name - The agent
 * @returns How the agent reads and starts its hook
 */
export function shellAgent(name: string): ShellAgent {
  const found = SHELL_AGENTS.find(each => each.agent === name);
  if (found === undefined) throw new Error(`${name} has no shell hook`);
  return found;
}

/**
 * Do what an agent does after one of its tools ran: start every command the
 * repository registers for that hook, with the event on standard input.
 * A hook that exits without reading the whole event fails the call, as it
 * would fail the agent's write; see `./agent-event-handoff.ts` for why the
 * event is not handed over through `spawnSync`'s `input`.
 * @param root - The repository
 * @param agent - The agent
 * @param event - The event the agent hands its hook
 * @param env - The environment; an operator's by default
 * @returns The finished hook, or `null` when the repository registers none
 */
export function deliver(
  root: string,
  agent: ShellAgent,
  event: unknown,
  env: NodeJS.ProcessEnv = operatorEnv()
): SpawnSyncReturns<string> | null {
  const [command, ...others] = agent.commands(readJson(root, agent.file));
  if (command === undefined) return null;
  if (others.length > 0) {
    throw new Error(`${agent.file} registers more than one hook command`);
  }
  return handOffEvent({
    label: `${agent.agent}'s hook after a file write`,
    command,
    cwd: root,
    env:
      agent.rootVariable === null
        ? env
        : { ...env, [agent.rootVariable]: root },
    event,
  });
}

/** OpenCode's plugin, as OpenCode loads it. */
type OpencodePlugin = (context: {
  readonly directory: string;
  readonly worktree: string;
}) => Promise<
  Readonly<Record<string, (input: unknown, output: unknown) => Promise<void>>>
>;

/**
 * Do what OpenCode does after one of its tools ran: load the plugin the
 * repository holds and call its hook.
 * @param root - The repository
 * @param tool - The tool that ran, as OpenCode names it
 * @param file - The file the tool wrote, from the repository root
 * @returns The message of the error the hook threw, or `null` when it let
 *   the tool call stand
 */
export async function deliverToOpencode(
  root: string,
  tool: string,
  file: string
): Promise<string | null> {
  const module = (await import(
    /* @vite-ignore */
    `${pathToFileURL(path.join(root, ".opencode/plugin/lisa-controls-carrier.js")).href}?${Date.now()}`
  )) as Readonly<Record<string, OpencodePlugin>>;
  const [plugin, ...others] = Object.values(module);
  if (plugin === undefined || others.length > 0) {
    throw new Error("the plugin file does not export exactly one plugin");
  }
  const hooks = await plugin({ directory: root, worktree: root });
  const after = hooks["tool.execute.after"];
  if (after === undefined)
    throw new Error("the plugin has no hook after a tool");
  const previous = process.env.PATH;
  process.env.PATH = operatorEnv().PATH;
  try {
    await after(
      {
        args: { filePath: path.join(root, file) },
        callID: "c1",
        sessionID: "s1",
        tool,
      },
      { metadata: {}, output: "", title: "" }
    );
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    process.env.PATH = previous;
  }
}
