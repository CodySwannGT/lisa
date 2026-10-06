// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Read-only provider routing instruments authenticated hook code, not arbitrary application Node programs. */
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  hostedHookContext,
  hookEntry,
  hookReadSlot,
  tokenFreeHookEnvironment,
} from "./npm-update-hosted-hook.mjs";
import { synchronousHookRead } from "./npm-update-hook-read-client.mjs";
import { required } from "./npm-update-contract.mjs";

const ENTRY = fileURLToPath(import.meta.url);
const original = {
  spawn: childProcess.spawn,
  spawnSync: childProcess.spawnSync,
  execFile: childProcess.execFile,
  execFileSync: childProcess.execFileSync,
};
const file = process.env.LISA_NPM_HOSTED_HOOK_CONTEXT;

function providerCall(context, entry, argv, command, args, options) {
  if (command !== "gh" && command !== context.native.gh.path) return null;
  const slot = hookReadSlot(entry, argv, process.env.LISA_NPM_HOOK_ROLE);
  required(slot !== null, "hook caller has no provider read recipe");
  return synchronousHookRead(
    context,
    slot,
    args,
    options,
    original.spawnSync,
    context.native.node.path
  );
}

/** Canonical children retain instrumentation; application processes receive neither token nor read-context channel. */
function nativeChild(context, command, args, options) {
  const env = tokenFreeHookEnvironment(options.env ?? process.env);
  delete env.LISA_NPM_HOSTED_HOOK_CONTEXT;
  if (
    command === "node" ||
    command === process.execPath ||
    command === context.native.node.path
  ) {
    const cwd = resolve(options.cwd ?? process.cwd());
    const entry = hookEntry(context, args, cwd);
    if (entry) {
      required(
        !args.some(arg =>
          /^(?:-r|--require|--import|--(?:experimental-)?loader)(?:=|$)/.test(
            arg
          )
        ),
        "unqualified canonical hook loader"
      );
      env.LISA_NPM_HOSTED_HOOK_CONTEXT = context.file;
      return {
        command: context.native.node.path,
        args: ["--import", pathToFileURL(ENTRY).href, ...args],
        options: { ...options, env },
      };
    }
  }
  return { command, args, options: { ...options, env } };
}

/** Preserve Node's documented optional argv/options overloads, including native buffers and FDs. */
function invocationArguments(args, options) {
  return Array.isArray(args)
    ? { args, options: options ?? {} }
    : { args: [], options: args ?? {} };
}

function initialize() {
  required(
    typeof file === "string" && file.length > 0,
    "hosted hook context is absent"
  );
  const context = hostedHookContext(file);
  const argv = [...process.execArgv.slice(2), ...process.argv.slice(1)];
  const entry = hookEntry(context, argv, process.cwd());
  required(
    entry !== null &&
      process.execArgv[0] === "--import" &&
      process.execArgv[1] === pathToFileURL(ENTRY).href &&
      !process.env.GH_TOKEN &&
      !process.env.GITHUB_TOKEN,
    "hosted provider caller is unqualified or credentialed"
  );
  for (const method of ["spawn", "spawnSync", "execFileSync"])
    childProcess[method] = (command, suppliedArgs, suppliedOptions) => {
      const { args, options } = invocationArguments(
        suppliedArgs,
        suppliedOptions
      );
      if (command === "gh" || command === context.native.gh.path) {
        required(
          method === "spawnSync",
          "hook provider requires synchronous native call"
        );
        return providerCall(context, entry, argv, command, args, options);
      }
      const selected = nativeChild(context, command, args, options);
      return original[method](
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
    let args = suppliedArgs,
      options = suppliedOptions,
      callback = suppliedCallback;
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
      command !== "gh" && command !== context.native.gh.path,
      "hook provider requires synchronous native call"
    );
    const selected = nativeChild(
      context,
      command,
      normalized.args,
      normalized.options
    );
    return original.execFile(
      selected.command,
      selected.args,
      selected.options,
      callback
    );
  };
  syncBuiltinESMExports();
}

initialize();
