/**
 * The text of the edit-time carrier's entry, and of the command that starts
 * it for each agent.
 *
 * Three texts are written into the repository:
 *
 * - The carrier's entry, a short POSIX `sh` script. It checks that Node is
 *   there, because everything after it is a Node program, and says so in the
 *   way the calling agent reads when it is not.
 * - The carrier's program (`./carrier-agent-program.ts`). It reads the event
 *   the agent hands its hook on standard input, runs the gate runner at the
 *   `post-tool` moment with `--builtins=none`, and answers the agent in the
 *   agent's own way when a required check is not proved.
 * - The command each agent's hook configuration runs. It finds the
 *   repository, refuses when the carrier is not there, and starts the entry
 *   with the agent's name.
 *
 * ## What the declared check is told
 *
 * When the event names exactly one written file, its path is exported as
 * `LISA_EDITED_FILE`, the variable Lisa's own on-edit hooks already set for a
 * declared task, so a check that wants to look at one file can. Nothing is
 * skipped on the strength of it: every check declared at `post-tool` runs
 * after every write, and a check that ignores the variable checks its whole
 * folder.
 *
 * ## What counts as a refusal
 *
 * Any exit of the runner other than 0, a runner that is missing, one that
 * cannot be started, and one that runs past its time limit. The write has
 * already happened by then; a refusal is the agent being told, in the one
 * way its hook contract passes on, that the file it wrote does not pass and
 * has to be fixed.
 * @module controls/carrier-agent-script
 */
import {
  answersWithContext,
  CARRIER_CHECKS,
  CARRIER_REFUSED,
} from "./carrier-agent-program.js";
import { AGENT_SURFACES } from "./carrier-agent-surfaces.js";
import { carrierMarkers } from "./carrier-script.js";
import {
  CARRIER_HOOKS_FOLDER,
  INSTALL_CARRIERS_INVOCATION,
} from "./carrier-types.js";
import {
  CODING_AGENTS,
  EDIT_TIME_MOMENT,
  type CodingAgent,
} from "./coding-agents.js";

/** The carrier's entry, from the repository root. */
export const AGENT_CARRIER_PATH = `${CARRIER_HOOKS_FOLDER}/${EDIT_TIME_MOMENT}`;

/** The carrier's program, from the repository root. */
export const AGENT_CARRIER_PROGRAM_PATH = `${AGENT_CARRIER_PATH}.mjs`;

/**
 * The variable an agent sets to the repository it is working in, for the
 * agents that set one. Left out, or unset when the hook runs, the repository
 * is asked of git.
 */
const ROOT_VARIABLE: Readonly<Partial<Record<CodingAgent, string>>> = {
  claude: "CLAUDE_PROJECT_DIR",
  cursor: "CURSOR_PROJECT_DIR",
  devin: "DEVIN_PROJECT_DIR",
};

/** The top folder of the repository, as a shell asks git for it. */
const GIT_ROOT = "$(git rev-parse --show-toplevel 2>/dev/null || pwd)";

/**
 * The one JSON object an agent that takes context is answered with.
 * @param message - The refusal, holding no single quote
 * @returns The object as text, safe inside single quotes in a shell
 */
function contextAnswer(message: string): string {
  return JSON.stringify({ additional_context: message });
}

/**
 * The agents answered with context printed on standard output.
 * @returns Their names, in agent order
 */
function contextAgents(): readonly CodingAgent[] {
  return CODING_AGENTS.filter(agent => {
    const surface = AGENT_SURFACES[agent];
    return surface.refuses && answersWithContext(surface);
  });
}

/**
 * The carrier's entry: the whole content of its file.
 *
 * It asks for Node before anything else: without Node the write must be
 * refused with a sentence that names what is missing, never pass having
 * checked nothing.
 * @returns The script, ending with a newline
 */
export function agentCarrierEntry(): string {
  const { begin, end } = carrierMarkers(EDIT_TIME_MOMENT);
  const missing = `${CARRIER_REFUSED} Node.js is missing (no node program on PATH), and ${CARRIER_CHECKS} cannot run without it.`;
  const answer = contextAnswer(missing);
  const contextArms = contextAgents().flatMap(agent => [
    `    ${agent})`,
    `      printf '%s\\n' '${answer}'`,
    "      exit 0",
    "      ;;",
  ]);
  return [
    "#!/bin/sh",
    begin,
    "# Runs the checks this repository declares for the moment after a coding",
    '# agent writes a file (the "gates" block of .lisa.config.json) and tells the',
    "# agent when a required check is not proved. The first argument is the",
    "# agent; the event it hands its hook arrives on standard input.",
    `# Written by "${INSTALL_CARRIERS_INVOCATION}". Run that again to change it.`,
    "if ! command -v node >/dev/null 2>&1; then",
    `  echo "${missing}" >&2`,
    ...(contextArms.length === 0
      ? []
      : ['  case "$1" in', ...contextArms, "  esac"]),
    "  exit 2",
    "fi",
    `exec node "$(dirname "$0")/${EDIT_TIME_MOMENT}.mjs" "$@"`,
    end,
    "",
  ].join("\n");
}

/**
 * The command an agent's hook configuration runs after a file write.
 *
 * It refuses when the carrier is not in the repository, in the way the agent
 * reads, so a checkout that lost the file never reads as one that passed.
 * @param agent - The agent; one that has a hook
 * @returns The command, for a POSIX shell
 */
export function agentHookCommand(agent: CodingAgent): string {
  const surface = AGENT_SURFACES[agent];
  const variable = ROOT_VARIABLE[agent];
  const root =
    variable === undefined ? GIT_ROOT : `\${${variable}:-${GIT_ROOT}}`;
  const fix = `Run: ${INSTALL_CARRIERS_INVOCATION} --agents=${agent}`;
  const inContext = contextAnswer(
    `${CARRIER_REFUSED} ${AGENT_CARRIER_PATH} is missing, so ${CARRIER_CHECKS} cannot run. ${fix}`
  );
  const missing =
    surface.refuses && answersWithContext(surface)
      ? `printf '%s\\n' '${inContext}'; exit 0`
      : `echo "${CARRIER_REFUSED} $f is missing, so ${CARRIER_CHECKS} cannot run. ${fix}" >&2; exit 2`;
  return `f="${root}/${AGENT_CARRIER_PATH}"; [ -f "$f" ] || { ${missing}; }; exec sh "$f" ${agent}`;
}
