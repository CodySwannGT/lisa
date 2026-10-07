// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Trusted canonical Node code forwards nested real tools before application code loads. */
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { resolve, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import {
  launcherContext,
  literalArguments,
} from "./npm-update-tool-launcher.mjs";
import {
  currentGraph,
  controllerRoute,
  controllerGraph,
} from "./npm-update-orchestrator.mjs";
import { binaryDigest } from "./npm-update-isolation.mjs";
import { required } from "./npm-update-contract.mjs";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { createGhDispatcher } from "./npm-update-gh-dispatch.mjs";

const ENTRY = fileURLToPath(import.meta.url);
const LAUNCHER = fileURLToPath(
  new URL("./npm-update-tool-launcher.mjs", import.meta.url)
);
const ORIGINAL = Object.fromEntries(
  ["spawn", "spawnSync", "execFile", "execFileSync"].map(name => [
    name,
    childProcess[name],
  ])
);
const SPELLINGS = {
  node: "node",
  npm: "npm",
  bun: "bun",
  ruby: "ruby",
  bundle: "bundle",
  sh: "shell",
  bash: "bash",
  gh: "gh",
  gitleaks: "gitleaks",
};

/** Matching filenames never qualify an arbitrary absolute native executable. */
function commandTool(context, command) {
  required(
    typeof command === "string" &&
      command.length <= 4096 &&
      !/[\n\0]/.test(command),
    "invalid nested native command"
  );
  const name = basename(command);
  if (command === process.execPath || command === context.controller.node.path)
    return "node";
  if (command === "git" || command === context.controller.git?.path)
    return "git";
  const tool = SPELLINGS[name];
  required(
    tool &&
      (!command.includes("/") ||
        command === context.runtime.tools[tool]?.path ||
        command === context.controller[tool]?.path ||
        (["/bin/sh", "/usr/bin/sh"].includes(command) && tool === "shell") ||
        (["/bin/bash", "/usr/bin/bash"].includes(command) && tool === "bash")),
    "unqualified nested native command route"
  );
  return tool;
}

/** Private instrumentation may be inherited only by authenticated canonical Node children. */
function childEnvironment(options, contextFile, canonical) {
  const env = { ...(options.env ?? process.env) };
  required(
    !env.NODE_OPTIONS && !env.NODE_PATH,
    "unqualified nested Node environment loader"
  );
  delete env.LISA_NPM_DISPATCH_CONTEXT;
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  if (canonical) env.LISA_NPM_DISPATCH_CONTEXT = contextFile;
  return env;
}

/** The proxy itself is genuine qualified Node; its exit is the real dispatched command exit. */
function nestedInvocation(context, contextFile, command, args, options) {
  literalArguments(args);
  required(
    options.shell !== true && typeof options.shell !== "string",
    "unqualified nested shell option; use the literal shell tool"
  );
  const cwd = resolve(options.cwd ?? process.cwd());
  const tool = commandTool(context, command);
  const node = context.controller.node;
  required(
    binaryDigest(node.path) === node.sha256 && node.version === "22.23.3",
    "controller Node identity changed"
  );
  if (tool === "git") {
    const git = context.controller.git;
    required(
      git &&
        realpathSync(git.path) === git.path &&
        binaryDigest(git.path) === git.sha256,
      "controller Git identity is unqualified"
    );
    return {
      command: git.path,
      args,
      options: {
        ...options,
        cwd,
        env: childEnvironment(options, contextFile, false),
      },
    };
  }
  const canonical =
    controllerRoute(
      tool,
      args,
      context.graph,
      currentGraph(controllerGraph(context.graph, context.routes)),
      cwd,
      context.routes,
      options.env ?? process.env
    ) === "controller";
  if (canonical && tool === "node") {
    const instrumentedArgs = ["--import", pathToFileURL(ENTRY).href, ...args];
    literalArguments(instrumentedArgs);
    return {
      command: node.path,
      args: instrumentedArgs,
      options: {
        ...options,
        cwd,
        env: childEnvironment(options, contextFile, true),
      },
    };
  }
  const proxyArgs = [
    LAUNCHER,
    "--context",
    contextFile,
    "--tool",
    tool,
    "--",
    ...args,
  ];
  literalArguments(proxyArgs);
  return {
    command: node.path,
    args: proxyArgs,
    options: {
      ...options,
      cwd,
      env: childEnvironment(options, contextFile, false),
    },
  };
}

/** Normalize only Node's documented argument overloads, retaining buffers, FDs and callbacks. */
function invocationArguments(args, options) {
  if (!Array.isArray(args)) return { args: [], options: args ?? {} };
  return { args, options: options ?? {} };
}

/** This instruments exclusively trusted code; it is not a sandbox for arbitrary same-process JS. */
export function initializeAdapter(contextFile) {
  const context = launcherContext(contextFile);
  const provider = scopedProvider(context);
  for (const method of ["spawn", "spawnSync", "execFileSync"])
    childProcess[method] = (command, args, options) => {
      const normalized = invocationArguments(args, options);
      if (
        provider &&
        (command === "gh" || command === context.provider.nativeGh.path)
      )
        return provider(
          method,
          command,
          normalized.args,
          normalized.options,
          ORIGINAL.spawnSync
        );
      const selected = nestedInvocation(
        context,
        contextFile,
        command,
        normalized.args,
        normalized.options
      );
      return ORIGINAL[method](
        selected.command,
        selected.args,
        selected.options
      );
    };
  childProcess.execFile = (
    command,
    suppliedArgs,
    suppliedOptions,
    suppliedCallback
  ) => {
    let args = suppliedArgs;
    let options = suppliedOptions;
    let callback = suppliedCallback;
    if (typeof args === "function") {
      callback = args;
      args = [];
      options = {};
    } else if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const normalized = invocationArguments(args, options);
    required(
      !provider ||
        (command !== "gh" && command !== context.provider.nativeGh.path),
      "credentialed GH requires synchronous canonical dispatch"
    );
    const selected = nestedInvocation(
      context,
      contextFile,
      command,
      normalized.args,
      normalized.options
    );
    return ORIGINAL.execFile(
      selected.command,
      selected.args,
      selected.options,
      callback
    );
  };
  syncBuiltinESMExports();
}

/** Graph membership and immutable argv/cwd qualify this genuine parent-owned canonical caller. */
function scopedProvider(context) {
  if (!context.provider) return null;
  const profile = context.provider;
  const preload = ["--import", pathToFileURL(ENTRY).href];
  required(
    canonicalJson(process.execArgv.slice(0, 2)) === canonicalJson(preload),
    "GH caller lacks qualified instrumentation"
  );
  const actual = [...process.execArgv.slice(2), ...process.argv.slice(1)];
  required(
    canonicalJson(actual) === canonicalJson(profile.invocation.args) &&
      realpathSync(process.cwd()) === profile.invocation.cwd &&
      Object.hasOwn(context.graph, profile.invocation.entry),
    "GH caller tuple differs"
  );
  required(
    actual[0] === profile.invocation.entry ||
      context.routes?.some(
        route =>
          route.tool === "node" &&
          route.entry === profile.invocation.entry &&
          canonicalJson(route.args) === canonicalJson(actual) &&
          route.cwd === profile.cwd
      ),
    "GH caller entry differs"
  );
  const route = controllerRoute(
    "node",
    actual,
    context.graph,
    currentGraph(controllerGraph(context.graph, context.routes)),
    profile.cwd,
    context.routes,
    process.env
  );
  required(
    route === "controller" &&
      realpathSync(process.execPath) === context.controller.node.path &&
      binaryDigest(process.execPath) === context.controller.node.sha256,
    "GH caller graph or interpreter differs"
  );
  return createGhDispatcher(profile, process.env.GH_TOKEN);
}

if (
  process.env.LISA_NPM_DISPATCH_CONTEXT &&
  process.execArgv.some(
    (value, index, values) =>
      value === `--import=${pathToFileURL(ENTRY).href}` ||
      (value === "--import" && values[index + 1] === pathToFileURL(ENTRY).href)
  )
)
  initializeAdapter(process.env.LISA_NPM_DISPATCH_CONTEXT);
