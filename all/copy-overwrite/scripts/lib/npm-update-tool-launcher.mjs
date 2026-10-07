// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Literal original tool invocations enter a qualified worker before application code loads. */
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, sep } from "node:path";
import { invokedAsScript } from "./invoked-as-script.mjs";
import { lstatSync, realpathSync } from "node:fs";
import { required, keys } from "./npm-update-contract.mjs";
import { readJson, runProcess } from "./npm-update-process.mjs";
import {
  controllerRoute,
  currentGraph,
  controllerGraph,
} from "./npm-update-orchestrator.mjs";
import { executeWorker, binaryDigest } from "./npm-update-isolation.mjs";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { validateGhProfile } from "./npm-update-gh-dispatch.mjs";

const TOOLS = new Set([
  "node",
  "npm",
  "bun",
  "ruby",
  "bundle",
  "shell",
  "bash",
  "gh",
  "gitleaks",
]);

/** Loading flags introduce a second interpreter authority and require separate qualification. */
export function literalArguments(args) {
  required(
    Array.isArray(args) &&
      args.length <= 512 &&
      args.every(
        arg =>
          typeof arg === "string" &&
          !arg.includes("\0") &&
          Buffer.byteLength(arg) <= 65_536
      ) &&
      Buffer.byteLength(JSON.stringify(args)) <= 262_144,
    "invalid or unbounded tool argument"
  );
}

/** npm's qualified CLI is launched by the qualified Node interpreter, never a host npm alias. */
export function toolInvocation(runtime, tool, args) {
  required(TOOLS.has(tool), "unsupported tool dispatch");
  literalArguments(args);
  if (tool === "node")
    required(
      !args.some(arg =>
        /^(?:-r|--require|--import|--(?:experimental-)?loader)(?:=|$)/.test(arg)
      ),
      "unqualified interpreter loader route"
    );
  const selected = runtime.tools[tool];
  required(
    selected &&
      typeof selected.path === "string" &&
      selected.path.startsWith("/"),
    "qualified tool is unavailable"
  );
  return tool === "npm"
    ? { command: runtime.tools.node.path, args: [selected.path, ...args] }
    : { command: selected.path, args: [...args] };
}

/** Caller-only private context is never mounted into candidate namespaces. */
export function launcherContext(file) {
  const value = readJson(file, 1_048_576);
  keys(value, [
    "version",
    "root",
    "cwd",
    "runtime",
    "boundary",
    "graph",
    "controller",
    ...([2, 3].includes(value.version) ? ["routes"] : []),
    ...(value.version === 3 ? ["provider"] : []),
  ]);
  required(
    [1, 2, 3].includes(value.version) &&
      typeof value.root === "string" &&
      resolve(file) === resolve(value.root, "launcher.json") &&
      typeof value.cwd === "string" &&
      value.cwd.startsWith("/"),
    "invalid controller launcher context"
  );
  if (value.version === 3 && value.provider !== null)
    validateGhProfile(value.provider);
  const root = lstatSync(value.root);
  required(
    root.isDirectory() &&
      !root.isSymbolicLink() &&
      realpathSync(value.root) === value.root &&
      root.uid === process.getuid() &&
      (root.mode & 0o077) === 0,
    "launcher context parent is not private controller storage"
  );
  required(
    value.graph &&
      typeof value.graph === "object" &&
      !Array.isArray(value.graph) &&
      Object.keys(value.graph).length <= 128,
    "unbounded trusted import graph"
  );
  controllerGraph(value.graph, value.routes);
  return value;
}

/** The first trusted Node entry needs the same qualified instrumentation as nested entries. */
function controllerInvocation(context, tool, args, env) {
  if (tool !== "node") return { args, env };
  const file = resolve(context.root, "launcher.json");
  required(
    canonicalJson(launcherContext(file)) === canonicalJson(context),
    "controller context bytes differ"
  );
  const adapter = fileURLToPath(
    new URL("./npm-update-execution-adapter.mjs", import.meta.url)
  );
  required(
    Object.hasOwn(context.graph, adapter),
    "trusted graph is missing the execution adapter"
  );
  required(
    !env.NODE_OPTIONS && !env.NODE_PATH,
    "unqualified controller environment loader"
  );
  return {
    args: ["--import", pathToFileURL(adapter).href, ...args],
    env: { ...env, LISA_NPM_DISPATCH_CONTEXT: file },
  };
}

/** Caller constraints narrow execution only; copied exit statuses cannot change after dispatch starts. */
function executionContract(value) {
  if (value === undefined)
    return {
      allowed: Array.from({ length: 256 }, (_, code) => code),
      timeout: 1_800_000,
      maximum: 8_388_608,
    };
  required(
    value && typeof value === "object" && !Array.isArray(value),
    "invalid execution contract object"
  );
  keys(value, [
    "allowed",
    "timeout",
    "maximum",
    ...(value.signal !== undefined ? ["signal"] : []),
  ]);
  required(
    value.signal === undefined || value.signal instanceof AbortSignal,
    "invalid controller cancellation signal"
  );
  const allowed = Array.isArray(value.allowed) ? [...value.allowed] : [];
  required(
    allowed.length > 0 &&
      allowed.length <= 256 &&
      new Set(allowed).size === allowed.length &&
      allowed.every(
        code => Number.isSafeInteger(code) && code >= 0 && code <= 255
      ),
    "invalid execution contract exit statuses"
  );
  required(
    Number.isSafeInteger(value.timeout) &&
      value.timeout > 0 &&
      value.timeout <= 1_800_000 &&
      Number.isSafeInteger(value.maximum) &&
      value.maximum > 0 &&
      value.maximum <= 8_388_608,
    "invalid execution contract deadline or output bound"
  );
  return {
    allowed,
    timeout: value.timeout,
    maximum: value.maximum,
    ...(value.signal !== undefined ? { signal: value.signal } : {}),
  };
}

/**
 * Full argv/stdin cross only the chosen boundary; worker output is captured privately by the caller.
 * @param {{allowed: number[], timeout: number, maximum: number}} [execution] Optional controller-only constraints.
 */
export async function dispatchTool(
  context,
  tool,
  args,
  input,
  env,
  cwd = context.cwd,
  execution = undefined
) {
  const contract = executionContract(execution);
  const actualCwd = realpathSync(cwd);
  const workspace = realpathSync(context.cwd);
  required(
    actualCwd === workspace || actualCwd.startsWith(`${workspace}${sep}`),
    "tool working directory escapes its qualified workspace"
  );
  const invocation = toolInvocation(context.runtime, tool, args);
  const route = controllerRoute(
    tool,
    args,
    context.graph,
    currentGraph(controllerGraph(context.graph, context.routes)),
    actualCwd,
    context.routes,
    env
  );
  if (route === "controller") {
    const identity = context.controller[tool];
    keys(identity, ["path", "version", "sha256"]);
    required(
      typeof identity.path === "string" &&
        identity.path.startsWith("/") &&
        typeof identity.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(identity.sha256) &&
        binaryDigest(identity.path) === identity.sha256,
      "qualified controller interpreter is unavailable or changed"
    );
    const original = controllerInvocation(context, tool, args, env);
    return runProcess(identity.path, original.args, {
      cwd: actualCwd,
      env: original.env,
      input,
      ...contract,
    });
  }
  required(
    execution === undefined,
    "scoped execution contract is unsupported on worker routes"
  );
  required(
    context.boundary.workspace === workspace,
    "unmatched candidate workspace mapping"
  );
  return executeWorker({ ...context.boundary, cwd: actualCwd }, invocation, {
    input,
    env,
  });
}

/** No diagnostic or container plumbing status substitutes for the actual dispatched tool exit. */
async function main() {
  const args = process.argv.slice(2);
  required(
    args.length >= 5 &&
      args[0] === "--context" &&
      args[2] === "--tool" &&
      args[4] === "--",
    "usage: launcher --context FILE --tool TOOL -- ARGV"
  );
  const context = launcherContext(args[1]);
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    required(size <= 4_194_304, "tool stdin exceeds bound");
    chunks.push(chunk);
  }
  const result = await dispatchTool(
    context,
    args[3],
    args.slice(5),
    Buffer.concat(chunks),
    process.env,
    process.cwd()
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}

if (invokedAsScript(import.meta.url))
  main().catch(error => {
    process.stderr.write(`npm tool dispatch: ${error.message}\n`);
    process.exitCode = 1;
  });
