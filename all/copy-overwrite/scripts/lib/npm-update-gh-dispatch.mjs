// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Credentialed native GH runs only for immutable controller-selected canonical requests. */
import { realpathSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { required, keys } from "./npm-update-contract.mjs";
import { binaryDigest } from "./npm-update-isolation.mjs";
import { isProviderTransport } from "./npm-update-worker-environment.mjs";
import {
  createGhRequests,
  createGhState,
  prepareGhRequest,
  observeGhResponse,
} from "./npm-update-gh-requests.mjs";

const OPTIONS = new Set([
  "cwd",
  "encoding",
  "env",
  "input",
  "timeout",
  "maxBuffer",
  "killSignal",
]);

export function validateGhProfile(profile) {
  keys(profile, [
    "version",
    "deadline",
    "cwd",
    "home",
    "nativeGh",
    "subject",
    "invocation",
  ]);
  keys(profile.nativeGh, ["path", "sha256"]);
  keys(profile.invocation, ["entry", "args", "cwd"]);
  const home = lstatSync(profile.home);
  required(
    profile.version === 1 &&
      Number.isSafeInteger(profile.deadline) &&
      profile.deadline > Date.now() &&
      profile.deadline <= Date.now() + 1_800_000 &&
      profile.cwd === realpathSync(profile.cwd) &&
      profile.home === realpathSync(profile.home) &&
      home.isDirectory() &&
      !home.isSymbolicLink() &&
      home.uid === process.getuid() &&
      (home.mode & 0o077) === 0,
    "invalid private native GH phase context"
  );
  required(
    typeof profile.invocation.entry === "string" &&
      profile.invocation.entry.startsWith("/") &&
      profile.invocation.cwd === profile.cwd &&
      Array.isArray(profile.invocation.args) &&
      profile.invocation.args.length > 0 &&
      profile.invocation.args.length <= 512 &&
      profile.invocation.args.every(
        value =>
          typeof value === "string" &&
          !value.includes("\0") &&
          Buffer.byteLength(value) <= 65536
      ) &&
      Buffer.byteLength(JSON.stringify(profile.invocation.args)) <= 262144,
    "invalid immutable GH caller tuple"
  );
  checkedNative(profile.nativeGh);
  createGhRequests(profile.subject);
  return JSON.parse(JSON.stringify(profile));
}

function checkedNative(identity) {
  const stat = lstatSync(identity.path);
  required(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      identity.path === realpathSync(identity.path) &&
      /^[a-f0-9]{64}$/.test(identity.sha256) &&
      binaryDigest(identity.path) === identity.sha256,
    "native GH identity changed"
  );
}

/** Caller options keep their original limits; no alternate transport or subprocess authority is accepted. */
function nativeOptions(profile, options, token) {
  required(
    options &&
      typeof options === "object" &&
      !Array.isArray(options) &&
      Object.keys(options).every(name => OPTIONS.has(name)),
    "unsupported native GH subprocess option"
  );
  required(
    (options.cwd ?? profile.cwd) === profile.cwd &&
      options.encoding === "utf8" &&
      options.input === undefined &&
      (options.killSignal === undefined || options.killSignal === "SIGKILL"),
    "native GH cwd/stdin/encoding differs"
  );
  const timeout = options.timeout ?? 30_000;
  const maximum = options.maxBuffer ?? 1_048_576;
  required(
    Number.isSafeInteger(timeout) &&
      timeout > 0 &&
      timeout <= 120_000 &&
      Number.isSafeInteger(maximum) &&
      maximum > 0 &&
      maximum <= 3_145_728,
    "native GH original capture bounds differ"
  );
  const environment = options.env ?? {};
  required(
    typeof environment === "object" &&
      !Array.isArray(environment) &&
      Object.values(environment).every(
        value =>
          value === undefined ||
          (typeof value === "string" && !value.includes("\0"))
      ) &&
      (!environment.GH_TOKEN || environment.GH_TOKEN === token) &&
      !environment.GITHUB_TOKEN,
    "native GH caller token or environment differs"
  );
  required(
    Object.entries(environment).every(
      ([name, value]) => !value || !isProviderTransport(name)
    ) &&
      (!environment.GH_HOST || environment.GH_HOST === "github.com") &&
      (!environment.GITHUB_API_URL ||
        environment.GITHUB_API_URL === "https://api.github.com") &&
      (!environment.GITHUB_SERVER_URL ||
        environment.GITHUB_SERVER_URL === "https://github.com"),
    "native GH transport environment override refused"
  );
  const remaining = profile.deadline - Date.now();
  required(remaining > 0, "native GH phase expired");
  return {
    cwd: profile.cwd,
    encoding: "utf8",
    timeout: Math.min(timeout, remaining),
    maxBuffer: maximum,
    killSignal: "SIGKILL",
    env: {
      PATH: "/usr/bin:/bin",
      HOME: profile.home,
      LANG: "C.UTF-8",
      GH_HOST: "github.com",
      GH_TOKEN: token,
      GH_CONFIG_DIR: join(profile.home, "gh-config"),
    },
  };
}

/** Saved ORIGINAL.spawnSync is supplied by trusted instrumentation, never serialized as a recipe. */
export function createGhDispatcher(suppliedProfile, token) {
  required(
    typeof token === "string" && token.length > 0 && !/[\0\r\n]/.test(token),
    "native GH token is absent or invalid"
  );
  const profile = validateGhProfile(suppliedProfile);
  const scope = createGhRequests(profile.subject);
  const state = createGhState(scope);
  return (method, command, args, options, nativeSpawnSync) => {
    required(
      method === "spawnSync" &&
        (command === "gh" || command === profile.nativeGh.path),
      "unqualified native GH invocation"
    );
    checkedNative(profile.nativeGh);
    const actualOptions = nativeOptions(profile, options, token);
    const request = prepareGhRequest(scope, state, args);
    const result = nativeSpawnSync(
      profile.nativeGh.path,
      [...args],
      actualOptions
    );
    observeGhResponse(scope, state, request, result);
    return result;
  };
}
