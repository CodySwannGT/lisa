// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Canonical synchronous callers receive the actual broker-owned native result, without a credential. */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { invokedAsScript } from "./invoked-as-script.mjs";
import { isProviderTransport } from "./npm-update-worker-environment.mjs";
import { readJson } from "./npm-update-process.mjs";
import { keys, required } from "./npm-update-contract.mjs";
import { requestHookRead } from "./npm-update-hook-provider.mjs";

const ENTRY = fileURLToPath(import.meta.url);
const OPTIONS = new Set([
  "cwd",
  "encoding",
  "env",
  "input",
  "timeout",
  "maxBuffer",
  "killSignal",
]);

/** Only public native bounds cross IPC; ambient environment, loaders and tokens never cross. */
function requestOptions(options, context) {
  required(
    options &&
      typeof options === "object" &&
      !Array.isArray(options) &&
      Object.keys(options).every(key => OPTIONS.has(key)),
    "unsupported canonical hook GH option"
  );
  required(
    options.encoding === "utf8" &&
      options.input === undefined &&
      (options.cwd === undefined || resolve(options.cwd) === context.cwd) &&
      (options.killSignal === undefined || options.killSignal === "SIGKILL"),
    "unsupported canonical hook GH options"
  );
  const env = options.env ?? process.env;
  required(
    env &&
      typeof env === "object" &&
      !Array.isArray(env) &&
      Object.values(env).every(
        value =>
          value === undefined ||
          (typeof value === "string" && !value.includes("\0"))
      ) &&
      !env.GH_TOKEN &&
      !env.GITHUB_TOKEN &&
      Object.entries(env).every(
        ([key, value]) => !value || !isProviderTransport(key)
      ) &&
      (!env.GH_HOST || env.GH_HOST === "github.com") &&
      (!env.GITHUB_API_URL ||
        env.GITHUB_API_URL === "https://api.github.com") &&
      (!env.GITHUB_SERVER_URL ||
        env.GITHUB_SERVER_URL === "https://github.com"),
    "hook caller contains provider credentials or transport overrides"
  );
  return {
    encoding: "utf8",
    timeout: options.timeout ?? 30_000,
    maxBuffer: options.maxBuffer ?? 1_048_576,
    killSignal: "SIGKILL",
  };
}

/** Native error/status distinctions survive the internal successful IPC process. */
export function hookNativeResult(value) {
  keys(value, ["status", "signal", "stdout", "stderr", "error"]);
  if (value.error !== null) keys(value.error, ["name", "code"]);
  required(
    (value.status === null ||
      (Number.isInteger(value.status) &&
        value.status >= 0 &&
        value.status <= 255)) &&
      (value.signal === null || /^SIG[A-Z0-9]+$/.test(value.signal)) &&
      (value.error === null ||
        (typeof value.error.name === "string" &&
          value.error.name.length <= 64 &&
          (value.error.code === null ||
            /^E[A-Z0-9]+$/.test(value.error.code)))),
    "invalid hook native status"
  );
  const bytes = [value.stdout, value.stderr].map(encoded => {
    required(
      typeof encoded === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded),
      "invalid hook native capture"
    );
    const decoded = Buffer.from(encoded, "base64");
    required(
      decoded.toString("base64") === encoded,
      "ambiguous hook native capture"
    );
    return decoded;
  });
  required(
    bytes[0].length + bytes[1].length <= 8_388_608,
    "hook native capture exceeded"
  );
  return {
    status: value.status,
    signal: value.signal,
    stdout: bytes[0].toString(),
    stderr: bytes[1].toString(),
    ...(value.error
      ? {
          error: Object.assign(
            new Error("native hook provider did not complete"),
            value.error
          ),
        }
      : {}),
  };
}

/** The selected source entry supplies saved native spawnSync; client subprocess cannot select GH authority. */
export function synchronousHookRead(
  context,
  slot,
  args,
  options,
  execute,
  node
) {
  const native = requestOptions(options, context);
  const timeout = Math.min(native.timeout, context.deadline - Date.now());
  required(timeout > 0, "hook provider phase expired");
  const result = execute(node, [ENTRY, context.file], {
    cwd: context.cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 11_185_000,
    killSignal: "SIGKILL",
    input: `${JSON.stringify({ slot, args, options: native })}\n`,
    env: { PATH: "/usr/bin:/bin", HOME: context.root, LANG: "C.UTF-8" },
  });
  if (result.error || result.signal || result.status !== 0)
    return { ...result, stdout: "", stderr: "" };
  return hookNativeResult(JSON.parse(result.stdout));
}

async function main() {
  required(process.argv.length === 3, "invalid hook read client arguments");
  const context = readJson(process.argv[2], 1_048_576);
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    required(length <= 262_144, "hook request exceeded");
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString());
  const result = await requestHookRead(context.reader, request);
  process.stdout.write(JSON.stringify(result));
}

if (invokedAsScript(import.meta.url))
  main().catch(() => {
    process.stderr.write("hook provider request refused\n");
    process.exitCode = 1;
  });
