// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Immutable recipes retain native status/capture while scoped helpers receive their authenticated bootstrap. */
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { required, keys } from "./npm-update-contract.mjs";
import { runProcess } from "./npm-update-process.mjs";
import { binaryDigest } from "./npm-update-isolation.mjs";
import {
  literalArguments,
  launcherContext,
  dispatchTool,
} from "./npm-update-tool-launcher.mjs";

/** The context is controller-created private data; every helper/graph/native tuple is rechecked at dispatch. */
export function checkedRecipe(recipe, node, graph) {
  keys(recipe, [
    "id",
    "command",
    "args",
    "cwd",
    "input",
    "env",
    "allowed",
    "timeout",
    "maximum",
    ...(recipe.context !== undefined ? ["context"] : []),
  ]);
  literalArguments(recipe.args);
  required(
    /^[a-zA-Z0-9-]{1,128}$/.test(recipe.id) &&
      recipe.command === node.path &&
      Object.hasOwn(graph, recipe.args[0]) &&
      recipe.cwd === realpathSync(recipe.cwd),
    "unqualified or duplicate broker recipe"
  );
  required(
    Buffer.isBuffer(recipe.input) &&
      recipe.input.length <= 4_194_304 &&
      Number.isSafeInteger(recipe.timeout) &&
      recipe.timeout > 0 &&
      recipe.timeout <= 1_800_000 &&
      Number.isSafeInteger(recipe.maximum) &&
      recipe.maximum > 0 &&
      recipe.maximum <= 8_388_608,
    "broker recipe input or capture bound differs"
  );
  required(
    recipe.env &&
      !recipe.env.NODE_OPTIONS &&
      !recipe.env.NODE_PATH &&
      Array.isArray(recipe.allowed) &&
      recipe.allowed.length > 0 &&
      recipe.allowed.length <= 256 &&
      recipe.allowed.every(
        code => Number.isInteger(code) && code >= 0 && code <= 255
      ),
    "broker recipe environment or status policy differs"
  );
  if (recipe.context !== undefined) {
    const actual = launcherContext(join(recipe.context.root, "launcher.json"));
    required(
      actual.version === 3 &&
        actual.provider !== null &&
        canonicalJson(actual) === canonicalJson(recipe.context) &&
        canonicalJson(actual.graph) === canonicalJson(graph) &&
        actual.controller.node.path === node.path &&
        actual.controller.node.sha256 === node.sha256 &&
        actual.provider.invocation.entry === recipe.args[0] &&
        canonicalJson(actual.provider.invocation.args) ===
          canonicalJson(recipe.args) &&
        actual.provider.invocation.cwd === recipe.cwd,
      "broker scoped helper context differs"
    );
  }
  return {
    ...recipe,
    args: [...recipe.args],
    input: Buffer.from(recipe.input),
    env: { ...recipe.env },
    allowed: [...recipe.allowed],
    ...(recipe.context !== undefined
      ? { context: JSON.parse(JSON.stringify(recipe.context)) }
      : {}),
  };
}

/** Completed nonzero children keep native status/output; cancellation never becomes success. */
export async function executeRecipe(recipe, deadline, signal, node) {
  const timeout = Math.min(recipe.timeout, deadline - Date.now());
  required(timeout > 0 && !signal.aborted, "broker phase expired");
  required(
    binaryDigest(node.path) === node.sha256,
    "broker native controller changed before dispatch"
  );
  const contract = {
    timeout,
    allowed: recipe.allowed,
    maximum: recipe.maximum,
  };
  try {
    if (recipe.context !== undefined)
      return await dispatchTool(
        recipe.context,
        "node",
        recipe.args,
        recipe.input,
        recipe.env,
        recipe.cwd,
        { ...contract, signal }
      );
    return await runProcess(recipe.command, recipe.args, {
      cwd: recipe.cwd,
      env: recipe.env,
      input: recipe.input,
      ...contract,
      signal,
    });
  } catch (error) {
    required(
      error.nativeCompleted === true &&
        Number.isInteger(error.code) &&
        error.code >= 0 &&
        error.code <= 255 &&
        Buffer.isBuffer(error.stdout) &&
        Buffer.isBuffer(error.stderr) &&
        error.stdout.length + error.stderr.length <= recipe.maximum &&
        !signal.aborted,
      "broker child did not complete normally"
    );
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}
