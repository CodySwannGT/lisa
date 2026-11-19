/**
 * The whole files that register the edit-time carrier with an agent whose
 * hooks are read from a file of their own.
 *
 * Two agents take a file Lisa can own outright, so nothing of the
 * repository's has to be merged into: Copilot reads every JSON file in
 * `.github/hooks/`, and OpenCode loads every module in `.opencode/plugin/`.
 * Both files are placed like the gate runner is: listed in the record of
 * what this command wrote, and never written over a file it did not write.
 *
 * Neither agent can narrow its hook to the tools that write a file the way a
 * matcher does, so the narrowing is done after the hook starts: by the
 * carrier's program for Copilot, and in the plugin for OpenCode.
 * @module controls/carrier-agent-files
 */
import {
  AGENT_CARRIER_PATH,
  agentHookCommand,
} from "./carrier-agent-script.js";
import {
  AGENT_HOOK_TIMEOUT_SECONDS,
  type PlacedRegistration,
} from "./carrier-agent-surfaces.js";
import { carrierMarkers } from "./carrier-script.js";
import {
  INSTALL_CARRIERS_INVOCATION,
  type PlacedFile,
} from "./carrier-types.js";
import { EDIT_TIME_MOMENT, type CodingAgent } from "./coding-agents.js";

/**
 * The hooks file Copilot reads from the repository.
 * @param agent - The agent the file registers the carrier for
 * @param event - The agent's name for the hook that runs after a tool
 * @returns The file's content, ending with a newline
 */
function copilotHooksFile(agent: CodingAgent, event: string): string {
  const document = {
    version: 1,
    hooks: {
      [event]: [
        {
          type: "command",
          bash: agentHookCommand(agent),
          cwd: ".",
          timeoutSec: AGENT_HOOK_TIMEOUT_SECONDS,
        },
      ],
    },
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * The plugin OpenCode loads from the repository.
 *
 * It is plain JavaScript with no template literal, so it can be held here as
 * lines, and it needs nothing but Node's own modules, which OpenCode's
 * runtime provides.
 * @param agent - The agent the plugin starts the carrier for
 * @param event - The agent's name for the hook that runs after a tool
 * @param tools - The tools that write a file, as the agent names them
 * @returns The module's content, ending with a newline
 */
function opencodePlugin(
  agent: CodingAgent,
  event: string,
  tools: readonly string[]
): string {
  const { begin, end } = carrierMarkers(EDIT_TIME_MOMENT);
  return [
    `// ${begin.slice(2)}`,
    "// After OpenCode writes a file, this starts the repository's edit-time",
    "// carrier, which runs the checks the repository declares for that moment",
    '// (the "gates" block of .lisa.config.json). When a required check is not',
    "// proved it throws, so OpenCode marks the tool call failed and shows the",
    "// agent why.",
    `// Written by "${INSTALL_CARRIERS_INVOCATION}". Run that again to change it.`,
    'import { spawn } from "node:child_process";',
    'import { existsSync } from "node:fs";',
    'import path from "node:path";',
    "",
    `const WRITE_TOOLS = ${JSON.stringify(tools)};`,
    `const CARRIER = ${JSON.stringify(AGENT_CARRIER_PATH)};`,
    "",
    "// Start the carrier with the event on its standard input, and hand back",
    "// how it ended and what it said.",
    "function carrierRun(root, event) {",
    "  return new Promise(resolve => {",
    `    const child = spawn("sh", [path.join(root, CARRIER), ${JSON.stringify(agent)}], {`,
    "      cwd: root,",
    '      stdio: ["pipe", "ignore", "pipe"],',
    "    });",
    '    let said = "";',
    '    child.stderr.on("data", chunk => {',
    "      said += chunk;",
    "    });",
    '    child.on("error", error => {',
    "      resolve({",
    "        code: 2,",
    '        said: "Write refused: the edit-time carrier could not be started (" + error.message + ").",',
    "      });",
    "    });",
    '    child.on("close", code => {',
    "      resolve({ code, said });",
    "    });",
    '    child.stdin.on("error", () => {});',
    "    child.stdin.end(JSON.stringify(event));",
    "  });",
    "}",
    "",
    "export const LisaControlsCarrier = async ({ directory, worktree }) => {",
    "  const root =",
    "    [worktree, directory].find(",
    '      folder => typeof folder === "string" && existsSync(path.join(folder, CARRIER))',
    "    ) ?? directory;",
    "  return {",
    `    ${JSON.stringify(event)}: async (input, output) => {`,
    '      const tool = String(input?.tool ?? "").toLowerCase();',
    "      if (!WRITE_TOOLS.includes(tool)) return;",
    "      const ran = await carrierRun(root, {",
    "        tool_name: tool,",
    "        tool_input: input?.args ?? output?.args ?? {},",
    "      });",
    "      if (ran.code === 0) return;",
    "      throw new Error(",
    "        ran.said.trim() ||",
    '          "Write refused: the edit-time carrier ended with status " + ran.code + " and said nothing."',
    "      );",
    "    },",
    "  };",
    "};",
    `// ${end.slice(2)}`,
    "",
  ].join("\n");
}

/**
 * The file that registers the carrier with an agent that reads its hooks
 * from a file of their own.
 * @param agent - The agent
 * @param event - The agent's name for the hook that runs after a tool
 * @param registration - Where the file goes and what it is
 * @returns The file as this command places it
 */
export function placedRegistration(
  agent: CodingAgent,
  event: string,
  registration: PlacedRegistration
): PlacedFile {
  return {
    content:
      registration.format === "copilot-hooks"
        ? copilotHooksFile(agent, event)
        : opencodePlugin(agent, event, registration.tools),
    executable: false,
    path: registration.file,
  };
}
