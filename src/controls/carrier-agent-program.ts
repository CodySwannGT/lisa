/**
 * The text of the edit-time carrier's program.
 *
 * The program is a Node module placed in the repository beside the commit
 * and push carriers. Whatever agent started it, it does four things in
 * order: reads the event the agent handed its hook, finds the written file's
 * checkout, runs the gate runner there at the `post-tool` moment with
 * `--builtins=none`, and, when a required check is not proved, tells the
 * agent in the one way that agent's hook contract passes on.
 *
 * It is written here as lines, a section at a time, and holds no template
 * literal, so no character in it needs escaping twice. It imports nothing
 * but Node's own modules: the repository it runs in may have no
 * `package.json`.
 * @module controls/carrier-agent-program
 */
import { checkoutSelection } from "./carrier-agent-checkout.js";
import {
  AGENT_SURFACES,
  type AgentHookSurface,
} from "./carrier-agent-surfaces.js";
import { carrierMarkers } from "./carrier-script.js";
import {
  CARRIER_RUNNER_PATH,
  INSTALL_CARRIERS_INVOCATION,
} from "./carrier-types.js";
import { CODING_AGENTS, EDIT_TIME_MOMENT } from "./coding-agents.js";

/** How long, in seconds, the checks may run before the carrier stops them. */
export const CARRIER_LIMIT_SECONDS = 120;

/** How much of a failure an agent that takes it as context is given. */
const CONTEXT_LIMIT = 4000;

/** What the checks the carrier runs are called in a sentence. */
export const CARRIER_CHECKS =
  "the checks this repository declares for a file write";

/** What every refusal starts with. */
export const CARRIER_REFUSED = "Write refused:";

/**
 * Tell whether an agent takes a refusal as context printed on standard
 * output rather than as an exit status.
 * @param surface - What the agent offers
 * @returns Whether the refusal is printed as one JSON object
 */
export function answersWithContext(surface: AgentHookSurface): boolean {
  return surface.refusal === "additional-context";
}

/**
 * What the program has to know about each agent that starts it.
 * @returns By agent: how it is answered, and the tools that write a file
 *   when the agent runs its hook after every tool
 */
function programAgents(): Readonly<
  Record<string, { readonly refusal: string; readonly tools: unknown }>
> {
  return Object.fromEntries(
    CODING_AGENTS.flatMap(agent => {
      const surface = AGENT_SURFACES[agent];
      // OpenCode's plugin narrows to its write tools before it starts the
      // carrier, and reads the carrier's exit status like any other caller.
      const everyTool =
        surface.refuses &&
        surface.registration.kind === "placed" &&
        surface.registration.format === "copilot-hooks";
      return surface.refuses
        ? [
            [
              agent,
              {
                refusal: answersWithContext(surface)
                  ? "additional-context"
                  : "exit-2",
                tools: everyTool ? surface.registration.tools : null,
              },
            ],
          ]
        : [];
    })
  );
}

/**
 * The program's imports and what it knows before it reads anything.
 * @returns The lines
 */
function preamble(): readonly string[] {
  return [
    'import { spawnSync } from "node:child_process";',
    'import { existsSync, lstatSync, realpathSync } from "node:fs";',
    'import path from "node:path";',
    'import { fileURLToPath } from "node:url";',
    "",
    "// How each agent is answered, and for an agent that runs its hook after",
    "// every tool, the tools that write a file.",
    `const AGENTS = ${JSON.stringify(programAgents(), null, 2)};`,
    `const LIMIT_SECONDS = ${CARRIER_LIMIT_SECONDS};`,
    `const CONTEXT_LIMIT = ${CONTEXT_LIMIT};`,
    'const PATH_KEYS = ["file_path", "filePath", "path", "notebook_path"];',
    'const PATCH_KEYS = ["command", "patch", "patchText", "input"];',
    "const PATCH_HEADER =",
    "  /^\\*\\*\\* (?:Add File|Update File|Delete File|Move to): (.+)$/;",
    "",
    "const program = fileURLToPath(import.meta.url);",
    'const root = path.resolve(path.dirname(program), "..", "..");',
    `const runner = path.join(root, ${JSON.stringify(CARRIER_RUNNER_PATH)});`,
    'const agent = process.argv[2] ?? "";',
    "const known = Object.hasOwn(AGENTS, agent) ? AGENTS[agent] : null;",
    "",
  ];
}

/**
 * The function that tells the agent a write does not pass.
 * @returns The lines
 */
function refusal(): readonly string[] {
  return [
    "// Tell the agent the write does not pass. Nothing is thrown and the",
    "// process is left to end by itself, so everything written is delivered.",
    "function refuse(why, detail) {",
    `  const text = [${JSON.stringify(CARRIER_REFUSED)} + " " + why, detail]`,
    "    .filter(Boolean)",
    '    .join("\\n");',
    '  process.stderr.write(text + "\\n");',
    '  if (known !== null && known.refusal === "additional-context") {',
    "    const kept =",
    "      text.length > CONTEXT_LIMIT",
    '        ? text.slice(0, 400) + "\\n[...]\\n" + text.slice(400 - CONTEXT_LIMIT)',
    "        : text;",
    "    process.stdout.write(",
    '      JSON.stringify({ additional_context: kept }) + "\\n"',
    "    );",
    "    return;",
    "  }",
    "  process.exitCode = 2;",
    "}",
    "",
  ];
}

/**
 * The functions that read the event and find the files it wrote.
 * @returns The lines
 */
function eventReading(): readonly string[] {
  return [
    "async function standardInput() {",
    '  if (process.stdin.isTTY) return "";',
    "  const chunks = [];",
    "  for await (const chunk of process.stdin) chunks.push(chunk);",
    '  return Buffer.concat(chunks).toString("utf8");',
    "}",
    "",
    "function parsed(text) {",
    "  try {",
    "    return JSON.parse(text);",
    "  } catch {",
    "    return null;",
    "  }",
    "}",
    "",
    "function keyed(value) {",
    '  return value !== null && typeof value === "object" && !Array.isArray(value);',
    "}",
    "",
    "// The tool an event is about and the files it wrote, as far as the event",
    "// says. An event that cannot be read names neither, and is checked.",
    "function writeEvent(text) {",
    "  const event = parsed(text);",
    "  if (!keyed(event)) return { tool: null, paths: [], cwd: process.cwd() };",
    "  const call = keyed(event.toolCall) ? event.toolCall : {};",
    "  const tool =",
    "    [event.tool_name, event.toolName, event.tool, call.name].find(",
    '      name => typeof name === "string" && name !== ""',
    "    ) ?? null;",
    "  const given = [event.tool_input, event.toolArgs, event.args, call.args].find(",
    "    value => value !== undefined && value !== null",
    "  );",
    "  const input =",
    '    typeof given === "string" ? (parsed(given) ?? { command: given }) : given;',
    "  const fields = keyed(input) ? input : {};",
    "  const named = PATH_KEYS.map(key => fields[key]).filter(",
    '    value => typeof value === "string" && value !== ""',
    "  );",
    "  const patched = PATCH_KEYS.map(key => fields[key])",
    '    .filter(value => typeof value === "string")',
    "    .flatMap(patch =>",
    '      patch.split("\\n").flatMap(line => {',
    "        const header = PATCH_HEADER.exec(line.trimEnd());",
    "        return header === null ? [] : [header[1]];",
    "      })",
    "    );",
    '  const cwd = typeof event.cwd === "string" ? path.resolve(event.cwd) : process.cwd();',
    "  return { tool, cwd, paths: [...new Set([...named, ...patched])] };",
    "}",
    "",
  ];
}

/**
 * The function that runs the gate runner and refuses when it does not pass.
 * @returns The lines
 */
function checking(): readonly string[] {
  const checks = JSON.stringify(CARRIER_CHECKS);
  return [
    "function runChecks(paths) {",
    "  const env = { ...process.env };",
    "  delete env.LISA_EDITED_FILE;",
    "  if (paths.length === 1) env.LISA_EDITED_FILE = paths[0];",
    "  const ran = spawnSync(",
    "    process.execPath,",
    `    [runner, "--moment=${EDIT_TIME_MOMENT}", "--builtins=none"],`,
    "    {",
    "      cwd: root,",
    '      encoding: "utf8",',
    "      env,",
    '      killSignal: "SIGKILL",',
    "      maxBuffer: 64 * 1024 * 1024,",
    "      timeout: LIMIT_SECONDS * 1000,",
    "    }",
    "  );",
    '  const said = [ran.stdout, ran.stderr].filter(Boolean).join("\\n").trimEnd();',
    '  if (ran.error !== undefined && ran.error.code === "ETIMEDOUT") {',
    "    refuse(",
    `      ${checks} +`,
    '        " ran for more than " +',
    "        LIMIT_SECONDS +",
    '        " seconds and were stopped, so this write was not checked. A check that slow belongs at commit or push: move it there in .lisa.config.json.",',
    "      said",
    "    );",
    "  } else if (ran.error !== undefined) {",
    "    refuse(",
    '      "the gate runner could not be started (" + ran.error.message + "), so " +',
    `        ${checks} +`,
    '        " did not run.",',
    "      said",
    "    );",
    "  } else if (ran.status !== 0) {",
    "    refuse(",
    '      "a check this repository declares for a file write was not proved (the gate runner " +',
    '        (ran.status === null ? "was stopped" : "exited " + ran.status) +',
    '        "). Fix what it reports below, then write the file again.",',
    "      said",
    "    );",
    "  }",
    "}",
    "",
  ];
}

/**
 * What the program does, top to bottom, once everything is defined.
 * @returns The lines
 */
function body(): readonly string[] {
  const unknownAgent = JSON.stringify(
    `, which is not a coding agent it knows. Register the agent again with "${INSTALL_CARRIERS_INVOCATION} --agents=<names>".`
  );
  const missingRunner = JSON.stringify(
    `${CARRIER_RUNNER_PATH} is missing, so ${CARRIER_CHECKS} cannot run. Run "${INSTALL_CARRIERS_INVOCATION}" to put it back.`
  );
  return [
    "const raw = await standardInput();",
    "const event = writeEvent(raw);",
    "if (known === null) {",
    "  refuse(",
    '    "this carrier was started for " +',
    "      JSON.stringify(agent) +",
    `      ${unknownAgent}`,
    "  );",
    "} else if (",
    "  known.tools !== null &&",
    "  event.tool !== null &&",
    "  !known.tools.includes(event.tool.toLowerCase())",
    ") {",
    "  // Not a file write: this agent runs its hook after every tool.",
    "} else {",
    "  const paths = pathsHere(event, raw);",
    "  if (paths !== null) {",
    `    if (!existsSync(runner)) refuse(${missingRunner});`,
    "    else runChecks(paths);",
    "  }",
    "}",
  ];
}

/**
 * The carrier's program: the whole content of its file.
 * @returns The program, ending with a newline
 */
export function agentCarrierProgram(): string {
  const { begin, end } = carrierMarkers(EDIT_TIME_MOMENT);
  return [
    "#!/usr/bin/env node",
    `// ${begin.slice(2)}`,
    "// Runs the checks this repository declares for the moment after a coding",
    '// agent writes a file (the "gates" block of .lisa.config.json) and tells the',
    "// agent, in the agent's own way, when a required check is not proved.",
    `// Written by "${INSTALL_CARRIERS_INVOCATION}". Run that again to change it.`,
    ...preamble(),
    ...refusal(),
    ...eventReading(),
    ...checkoutSelection(),
    ...checking(),
    ...body(),
    `// ${end.slice(2)}`,
    "",
  ].join("\n");
}
