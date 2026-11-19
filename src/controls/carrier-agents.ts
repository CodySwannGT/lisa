/**
 * Planning the edit-time carriers: one per coding agent on the roster.
 *
 * Each agent that has a hook after a file write gets that hook registered in
 * the file the agent reads from the repository, so the carrier is there for
 * everyone who clones it and does not depend on a Lisa project type or on a
 * plugin being installed. The hook starts the carrier in `.lisa/hooks/`,
 * which runs the gate runner at the `post-tool` moment.
 *
 * - Claude Code, Codex, Cursor and Devin read a settings file the repository
 *   may already own. One entry is merged into it; see
 *   `./carrier-agent-settings.ts`. A file that cannot be read is left alone,
 *   and the point is blocked with the entry to add by hand.
 * - Copilot and OpenCode read a file Lisa can own outright; see
 *   `./carrier-agent-files.ts`.
 * - An agent with no such hook gets nothing installed. The gap is written
 *   into the gates declaration instead; see `./carrier-unenforceable.ts`.
 *
 * Which agent is which is one table: `./carrier-agent-surfaces.ts`.
 * @module controls/carrier-agents
 */
import path from "node:path";

import { placedRegistration } from "./carrier-agent-files.js";
import { agentCarrierProgram } from "./carrier-agent-program.js";
import {
  AGENT_CARRIER_PATH,
  AGENT_CARRIER_PROGRAM_PATH,
  agentCarrierEntry,
  agentHookCommand,
  agentHookCommandsWritten,
} from "./carrier-agent-script.js";
import { hookEntry, mergeHookEntry } from "./carrier-agent-settings.js";
import {
  AGENT_SURFACES,
  type AgentHookSurface,
  type MergedRegistration,
} from "./carrier-agent-surfaces.js";
import {
  blockedFolder,
  fileEdit,
  fileState,
  type FileState,
} from "./carrier-edits.js";
import {
  AGENT_CONFIG,
  NO_HOOK_SURFACE,
  type AgentPointPlan,
  type CarrierEdit,
  type FileEdit,
  type KindPlan,
  type PlacedFile,
} from "./carrier-types.js";
import { recordUnenforceable } from "./carrier-unenforceable.js";
import { EDIT_TIME_MOMENT, type CodingAgent } from "./coding-agents.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import { UNENFORCEABLE_ON_KEY } from "./unenforceable-agents.js";

/**
 * Every file this kind of carrier may place, for any roster. The record of
 * what the command wrote keeps these across a run that carries fewer agents.
 */
export const AGENT_PLACED_PATHS: readonly string[] = [
  AGENT_CARRIER_PATH,
  AGENT_CARRIER_PROGRAM_PATH,
  ...Object.values(AGENT_SURFACES).flatMap(surface =>
    surface.refuses && surface.registration.kind === "placed"
      ? [surface.registration.file]
      : []
  ),
];

/** One agent's point and the write behind it, if any. */
interface AgentWiring {
  readonly point: AgentPointPlan;
  readonly edit: FileEdit | null;
}

/**
 * The files every edit-time hook starts.
 * @returns The carrier's entry and its program
 */
function carrierFiles(): readonly PlacedFile[] {
  return [
    {
      content: agentCarrierEntry(),
      executable: true,
      path: AGENT_CARRIER_PATH,
    },
    {
      content: agentCarrierProgram(),
      executable: false,
      path: AGENT_CARRIER_PROGRAM_PATH,
    },
  ];
}

/**
 * Read a file a plan may write, as text.
 * @param state - What is at the path
 * @returns The content of an ordinary file, or `null`
 */
function textOf(state: FileState): string | null {
  return state.content === null ? null : state.content.toString("utf8");
}

/**
 * Say what to add by hand to a settings file this command will not touch.
 * @param registration - Where the entry goes
 * @param command - The command the hook runs
 * @returns The sentence, holding the exact entry
 */
function byHand(registration: MergedRegistration, command: string): string {
  return `Add this entry by hand to the list at "${registration.path.join(".")}" in ${registration.file}, then run this again: ${JSON.stringify(hookEntry(registration, command))}`;
}

/**
 * Plan the entry in a settings file the repository may own.
 * @param root - Real path of the repository
 * @param agent - The agent
 * @param surface - What the agent offers
 * @param registration - Where the entry goes
 * @returns The point and the write
 */
async function throughSettings(
  root: string,
  agent: CodingAgent,
  surface: AgentHookSurface,
  registration: MergedRegistration
): Promise<AgentWiring> {
  const command = agentHookCommand(agent);
  const point = (
    call: AgentPointPlan["call"],
    blocked: string | null
  ): AgentPointPlan => ({
    agent,
    blocked,
    call,
    hook: surface.event,
    moment: EDIT_TIME_MOMENT,
    path: registration.file,
    refusal: { evidence: surface.evidence, signal: surface.refusal },
    through: AGENT_CONFIG,
  });
  const refuse = (why: string): AgentWiring => ({
    edit: null,
    point: point("absent", `${why} ${byHand(registration, command)}`),
  });
  const folder = await blockedFolder(root, registration.file);
  if (folder !== null) {
    return refuse(
      `${folder} is not an ordinary folder (it may be a link), so nothing in it was read or written.`
    );
  }
  const absolute = path.join(root, registration.file);
  const state = await fileState(absolute);
  if (state.kind !== "file" && state.kind !== "missing") {
    return refuse(
      `${registration.file} is not an ordinary file, so it was left untouched.`
    );
  }
  const merged = mergeHookEntry(
    textOf(state),
    registration,
    agentHookCommandsWritten(agent)
  );
  if (merged.problem !== null) return refuse(merged.problem);
  return {
    edit: fileEdit(
      {
        absolute,
        content: merged.text,
        executable: false,
        path: registration.file,
      },
      state
    ),
    point: point(merged.state, null),
  };
}

/**
 * Plan the point of an agent whose hooks are read from a file Lisa places.
 * @param root - Real path of the repository
 * @param agent - The agent
 * @param surface - What the agent offers
 * @param file - The file as it should be
 * @returns The point; the write is made with the other placed files
 */
async function throughPlacedFile(
  root: string,
  agent: CodingAgent,
  surface: AgentHookSurface,
  file: PlacedFile
): Promise<AgentWiring> {
  const state = await fileState(path.join(root, file.path));
  const same =
    state.content !== null && state.content.equals(Buffer.from(file.content));
  return {
    edit: null,
    point: {
      agent,
      blocked: null,
      call: same ? "present" : state.kind === "missing" ? "added" : "replaced",
      hook: surface.event,
      moment: EDIT_TIME_MOMENT,
      path: file.path,
      refusal: { evidence: surface.evidence, signal: surface.refusal },
      through: AGENT_CONFIG,
    },
  };
}

/** The points of the agents with no hook, and the write that records them. */
interface GapWiring {
  readonly points: readonly AgentPointPlan[];
  readonly edit: FileEdit | null;
}

/**
 * Plan the record of every agent on the roster that has no hook.
 * @param root - Real path of the repository
 * @param agents - Those agents, in roster order
 * @returns One point per agent, and the write to the gates declaration
 */
async function recordGaps(
  root: string,
  agents: readonly CodingAgent[]
): Promise<GapWiring> {
  if (agents.length === 0) return { edit: null, points: [] };
  const absolute = path.join(root, GATES_DECLARATION_PATH);
  const state = await fileState(absolute);
  const record =
    state.kind !== "file" && state.kind !== "missing"
      ? {
          problem: `${GATES_DECLARATION_PATH} is not an ordinary file, so it was left untouched.`,
        }
      : recordUnenforceable(textOf(state), agents);
  const whyOf = (agent: CodingAgent): string => {
    const surface = AGENT_SURFACES[agent];
    return surface.refuses ? "" : surface.why;
  };
  if (record.problem !== null) {
    return {
      edit: null,
      points: agents.map(agent => ({
        agent,
        blocked: `${whyOf(agent)} That could not be written down: ${record.problem} Add "${UNENFORCEABLE_ON_KEY}": ${JSON.stringify([agent])} by hand to the "${EDIT_TIME_MOMENT}" entry of each gate in ${GATES_DECLARATION_PATH}, then run this again.`,
        call: "absent",
        hook: null,
        moment: EDIT_TIME_MOMENT,
        path: GATES_DECLARATION_PATH,
        through: NO_HOOK_SURFACE,
        unenforceable: { reason: whyOf(agent), recordedOn: [] },
      })),
    };
  }
  return {
    edit:
      record.gates.length === 0
        ? null
        : fileEdit(
            {
              absolute,
              content: record.text,
              executable: false,
              path: GATES_DECLARATION_PATH,
            },
            state
          ),
    points: agents.map(agent => ({
      agent,
      blocked: null,
      call: record.added.includes(agent) ? "added" : "present",
      hook: null,
      moment: EDIT_TIME_MOMENT,
      path: record.gates.length === 0 ? null : GATES_DECLARATION_PATH,
      through: NO_HOOK_SURFACE,
      unenforceable: { reason: whyOf(agent), recordedOn: record.gates },
    })),
  };
}

/**
 * Plan the edit-time carrier of every coding agent on a roster.
 * @param root - Real path of the repository
 * @param agents - The roster, in the order the result lists it
 * @returns What each agent's point becomes, the files the hooks start, and
 *   the writes
 */
export async function planAgentCarriers(
  root: string,
  agents: readonly CodingAgent[]
): Promise<KindPlan> {
  const hooked = agents.flatMap(agent => {
    const surface = AGENT_SURFACES[agent];
    return surface.refuses ? [{ agent, surface }] : [];
  });
  const placed = hooked.flatMap(({ agent, surface }) =>
    surface.registration.kind === "placed"
      ? [placedRegistration(agent, surface.event, surface.registration)]
      : []
  );
  const [wired, gaps] = await Promise.all([
    Promise.all(
      hooked.map(({ agent, surface }) => {
        const { registration } = surface;
        return registration.kind === "merged"
          ? throughSettings(root, agent, surface, registration)
          : throughPlacedFile(
              root,
              agent,
              surface,
              placedRegistration(agent, surface.event, registration)
            );
      })
    ),
    recordGaps(
      root,
      agents.filter(agent => !AGENT_SURFACES[agent].refuses)
    ),
  ]);
  const pointOf = new Map<CodingAgent, AgentPointPlan>(
    [...wired.map(each => each.point), ...gaps.points].map(point => [
      point.agent,
      point,
    ])
  );
  const edits: readonly CarrierEdit[] = [
    ...wired.flatMap(each => (each.edit === null ? [] : [each.edit])),
    ...(gaps.edit === null ? [] : [gaps.edit]),
  ];
  return {
    edits,
    kind: "agent-hook",
    points: agents.flatMap(agent => {
      const point = pointOf.get(agent);
      return point === undefined ? [] : [point];
    }),
    // The carrier first, then what starts it: a run that is interrupted
    // never leaves an agent's hook pointing at a file that is not there.
    scripts: hooked.length === 0 ? [] : [...carrierFiles(), ...placed],
  };
}
