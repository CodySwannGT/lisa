/** Read the repository's installed edit-time hooks as data. @module */
import path from "node:path";

import {
  AGENT_CARRIER_PATH,
  agentCarrierEntry,
  agentHookCommandsWritten,
} from "./carrier-agent-script.js";
import { registeredHookCommands } from "./carrier-agent-settings.js";
import { AGENT_SURFACES } from "./carrier-agent-surfaces.js";
import { blockedFolder } from "./carrier-edits.js";
import { EDIT_TIME_MOMENT, type CodingAgent } from "./coding-agents.js";
import { declaredBy } from "./reconcile-declared.js";
import {
  MAX_HOOK_CHARACTERS,
  readShellHook,
  type ShellCommand,
} from "./reconcile-hook-lines.js";
import { hookFileText, type HooksRead } from "./reconcile-hooks.js";
import type { HookCommand } from "./reconcile-types.js";
import type { ControlRegister } from "./register-types.js";

/** Exact generated lines are infrastructure. Extra lines inside the block still count. */
const CARRIER_LINES = new Set(
  agentCarrierEntry()
    .split("\n")
    .map(line => line.trim())
);

/** One source file's commands and whether it starts Lisa's installed carrier. */
interface EditTimeRead {
  readonly file: string;
  readonly hook: string;
  readonly commands: readonly ShellCommand[];
  readonly problem: string | null;
  readonly registered?: CodingAgent;
}

/** Read only ordinary files under ordinary repository directories.
 * @param root - Real repository root
 * @param file - Repository-relative hook path
 * @returns File text or the result of trying to read it
 */
async function editTimeText(
  root: string,
  file: string
): ReturnType<typeof hookFileText> {
  const blocked = await blockedFolder(root, file);
  return blocked === null
    ? hookFileText(path.join(root, file), file)
    : {
        problem: `${blocked} is not an ordinary folder, so ${file} was not read.`,
        text: null,
      };
}

/** Read the shared shell carrier, including custom lines inside Lisa's markers.
 * @param root - Real repository root
 * @returns What the carrier contributed, if it exists
 */
async function readCarrier(root: string): Promise<EditTimeRead | null> {
  const file = AGENT_CARRIER_PATH;
  const { text, problem } = await editTimeText(root, file);
  const read = text === null ? null : readShellHook(text, CARRIER_LINES);
  const detail = problem ?? read?.problem ?? null;
  return read === null && detail === null
    ? null
    : {
        commands: read?.problem === null ? read.commands : [],
        file,
        hook: EDIT_TIME_MOMENT,
        problem: detail === null ? null : `In ${file}, ${detail}`,
      };
}

/** Read one agent's effective shell registration at the edit-time event.
 * @param root - Real repository root
 * @param agent - One agent with a recorded registration
 * @returns What the file contributed, if it exists
 */
async function readRegistration(
  root: string,
  agent: CodingAgent
): Promise<EditTimeRead | null> {
  const surface = AGENT_SURFACES[agent];
  if (!surface.refuses) return null;
  const { registration, event: hook } = surface;
  const { file } = registration;
  // The carrier check compares the installed OpenCode JavaScript with the
  // exact owned registration. The shell reader cannot interpret a plugin.
  if (
    registration.kind === "placed" &&
    registration.format === "opencode-plugin"
  )
    return null;
  const { text, problem } = await editTimeText(root, file);
  if (text === null)
    return problem === null ? null : { commands: [], file, hook, problem };
  if (text.length > MAX_HOOK_CHARACTERS) {
    return {
      commands: [],
      file,
      hook,
      problem: `${file} exceeds the ${MAX_HOOK_CHARACTERS}-character hook read limit.`,
    };
  }
  const settings =
    registration.kind === "merged"
      ? registeredHookCommands(text, registration)
      : registeredHookCommands(
          text,
          { file, path: ["hooks", hook], shape: "flat" },
          ["bash", "command"]
        );
  const owned = agentHookCommandsWritten(agent);
  const isCarrier = (command: string): boolean => owned.includes(command);
  const registered = settings.commands.some(
    row =>
      isCarrier(row.command) &&
      (registration.kind === "placed" || row.matcher === registration.matcher)
  );
  const read = settings.commands.flatMap(row =>
    isCarrier(row.command)
      ? []
      : [{ line: row.line, result: readShellHook(row.command) }]
  );
  return {
    commands: read.flatMap(({ line, result }) =>
      result.problem === null
        ? result.commands.map(command => ({ ...command, line }))
        : []
    ),
    file,
    hook,
    problem:
      settings.problem ??
      read.find(each => each.result.problem !== null)?.result.problem ??
      null,
    ...(registered ? { registered: agent } : {}),
  };
}

/** The commands and matching carrier calls observed in recorded settings. */
export interface EditTimeHooks extends HooksRead {
  readonly registrations: ReadonlySet<CodingAgent>;
}

/** Compare installed shell commands with the register without running them.
 * @param root - Real repository root
 * @param agentCarrier - Whether the installed-files record names the shared hook
 * @param agents - Agents with recorded edit-time carrier registrations
 * @param register - The control register for the repository
 * @returns The observed commands, matched registrations and unreadable files
 */
export async function readEditTimeHooks(
  root: string,
  agentCarrier: boolean,
  agents: readonly CodingAgent[],
  register: ControlRegister
): Promise<EditTimeHooks> {
  const files = !agentCarrier
    ? []
    : (
        await Promise.all([
          readCarrier(root),
          ...agents.map(agent => readRegistration(root, agent)),
        ])
      ).filter(file => file !== null);
  return {
    commands: files.flatMap(({ commands, file, hook }) =>
      commands.map(
        (command): HookCommand => ({
          command: command.command,
          declared_by: declaredBy(register, EDIT_TIME_MOMENT, command.words),
          hook,
          line: command.line,
          moment: EDIT_TIME_MOMENT,
          path: file,
          through: "coding-agent",
        })
      )
    ),
    files: files.map(each => each.file),
    problems: files.flatMap(each =>
      each.problem === null ? [] : [each.problem]
    ),
    registrations: new Set(files.flatMap(each => each.registered ?? [])),
  };
}
