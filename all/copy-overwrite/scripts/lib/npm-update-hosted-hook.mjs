// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Original Node hook calls preserve argv/stdin while only authenticated helpers gain a read-only IPC route. */
import { readJson, runProcess } from "./npm-update-process.mjs";
import { required, keys } from "./npm-update-contract.mjs";
import { currentGraph } from "./npm-update-orchestrator.mjs";
import { realpathSync, lstatSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { binaryDigest } from "./npm-update-isolation.mjs";

const ENTRY = fileURLToPath(import.meta.url);
const PRELOAD = fileURLToPath(
  new URL("./npm-update-hook-preload.mjs", import.meta.url)
);
const RAILS_INLINE =
  'try { const { main } = await import("./scripts/lisa-rails-prepush.mjs"); process.exitCode = await main(process.argv.slice(1)); } catch { console.error("Managed Rails push tooling is unavailable or damaged. Run full Lisa apply and retry; raw bootstrap errors are withheld."); process.exitCode = 1; }';

/** Context carries no token; the broker independently retains its immutable read subject in parent memory. */
export function hostedHookContext(file) {
  const context = readJson(file, 1_048_576);
  keys(context, ["version", "root", "cwd", "graph", "native", "reader"]);
  keys(context.reader, ["root", "path", "deadline"]);
  keys(context.native, ["node", "git", "gh"]);
  keys(context.native.node, ["path", "version", "sha256"]);
  const root = lstatSync(context.root);
  required(
    context.version === 1 &&
      file === join(context.root, "hosted-hooks.json") &&
      realpathSync(context.root) === context.root &&
      realpathSync(context.cwd) === context.cwd &&
      root.isDirectory() &&
      !root.isSymbolicLink() &&
      root.uid === process.getuid() &&
      (root.mode & 0o077) === 0 &&
      context.reader.root === context.root &&
      context.reader.path === join(context.root, "hook-reader.sock") &&
      Number.isSafeInteger(context.reader.deadline) &&
      context.reader.deadline > Date.now() &&
      context.reader.deadline <= Date.now() + 1_800_000,
    "invalid hosted hook context"
  );
  const observed = currentGraph(context.graph);
  required(
    Object.keys(observed).length <= 128 &&
      Object.entries(context.graph).every(
        ([path, hash]) => observed[path] === hash
      ),
    "authenticated hook graph changed"
  );
  required(
    context.native.node.version === "22.23.3" &&
      context.native.node.path === realpathSync(context.native.node.path) &&
      binaryDigest(context.native.node.path) === context.native.node.sha256,
    "hosted hook Node changed"
  );
  return { ...context, file, deadline: context.reader.deadline };
}

/** Inline qualification is one exact managed Rails bootstrap; arbitrary eval stays ordinary token-free application code. */
export function hookEntry(context, args, cwd) {
  if (
    args[0] === "--input-type=module" &&
    args[1] === "-e" &&
    args[2] === RAILS_INLINE
  ) {
    const entry = join(cwd, "scripts/lisa-rails-prepush.mjs");
    return Object.hasOwn(context.graph, entry) ? entry : null;
  }
  if (typeof args[0] !== "string" || args[0].startsWith("-")) return null;
  const entry = resolve(cwd, args[0]);
  return Object.hasOwn(context.graph, entry) ? entry : null;
}

/** Slots are limited read-state labels; they cannot grant a writer or widen the parent's subject. */
export function hookReadSlot(entry, args, role) {
  const name = basename(entry);
  if (name === "lisa-work-item.mjs") {
    if (args[1] === "prepare-commit-msg") return "commit-prepare";
    if (args[1] === "validate-commit") return "commit-work-item";
    if (args[1] === "validate-push" && ["audit", "destination"].includes(role))
      return `${role}-work-item`;
  }
  if (name === "lisa-automation-provenance.mjs") {
    if (args[1] === "check-commit") return "commit-provenance";
    if (args[1] === "check-push" && ["audit", "destination"].includes(role))
      return `${role}-provenance`;
  }
  return null;
}

/** Provider tokens, issuer secrets and ambient preload authority are absent from both helper and application processes. */
export function tokenFreeHookEnvironment(source) {
  const env = { ...source };
  for (const name of Object.keys(env))
    if (
      /^(?:GH_TOKEN|GITHUB_TOKEN|ACTIONS_ID_TOKEN_|ACTIONS_RUNTIME_|LISA_NPM_DISPATCH_CONTEXT|NODE_OPTIONS|NODE_PATH)/.test(
        name
      )
    )
      delete env[name];
  return env;
}

async function main() {
  const args = process.argv.slice(2);
  required(
    args.length >= 3 && args[0] === "--context" && args[2] === "--",
    "invalid hosted Node gateway"
  );
  const context = hostedHookContext(args[1]);
  const original = args.slice(3);
  const entry = hookEntry(context, original, realpathSync(process.cwd()));
  if (entry)
    required(
      !original.some(arg =>
        /^(?:-r|--require|--import|--(?:experimental-)?loader)(?:=|$)/.test(arg)
      ) &&
        !process.env.NODE_OPTIONS &&
        !process.env.NODE_PATH,
      "unqualified original canonical hook loader"
    );
  const env = tokenFreeHookEnvironment(process.env);
  if (entry) env.LISA_NPM_HOSTED_HOOK_CONTEXT = context.file;
  else delete env.LISA_NPM_HOSTED_HOOK_CONTEXT;
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    required(size <= 4_194_304, "original hook stdin exceeded");
    chunks.push(chunk);
  }
  const timeout = Math.min(1_800_000, context.deadline - Date.now());
  required(timeout > 0, "original hook phase expired");
  const result = await runProcess(
    context.native.node.path,
    entry ? ["--import", pathToFileURL(PRELOAD).href, ...original] : original,
    {
      cwd: process.cwd(),
      env,
      input: Buffer.concat(chunks),
      timeout,
      maximum: 8_388_608,
      allowed: Array.from({ length: 256 }, (_, code) => code),
    }
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}

if (process.argv[1] && resolve(process.argv[1]) === ENTRY)
  main().catch(() => {
    process.stderr.write("original hosted hook command failed\n");
    process.exitCode = 1;
  });
