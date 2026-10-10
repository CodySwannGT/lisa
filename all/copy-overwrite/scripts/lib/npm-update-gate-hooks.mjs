// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Original hook transport distinguishes artifact audit from actual remote state. */
// Preload dependencies must not execute the entry CLI before instrumentation.
import { canonicalJson } from "./automation-provenance-contract.mjs";
import { required, OBJECT, keys } from "./npm-update-contract.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
export { managedTemplateMembers } from "./npm-update-helper-graph.mjs";
export {
  originalPrePush,
  originalHookInstallation,
} from "./npm-update-hook-installation.mjs";

/** Private parent-created tuples remain data; their configuration and helper authority is qualified separately. */
function configuredTuple(route, graph) {
  keys(route, ["tool", "args", "cwd", "entry", "configuration", "environment"]);
  required(
    ["node", "shell", "bash"].includes(route.tool) &&
      typeof route.cwd === "string" &&
      route.cwd.startsWith("/") &&
      !route.cwd.split("/").includes(".."),
    "invalid configured controller tuple"
  );
  required(
    Array.isArray(route.args) &&
      route.args.length <= 512 &&
      route.args.every(
        value =>
          typeof value === "string" &&
          !value.includes("\0") &&
          Buffer.byteLength(value) <= 65_536
      ) &&
      Buffer.byteLength(canonicalJson(route.args)) <= 262_144,
    "unbounded configured command tuple"
  );
  required(
    route.entry === null ||
      (typeof route.entry === "string" && Object.hasOwn(graph, route.entry)),
    "configured helper entry is unqualified"
  );
  if (route.tool === "node")
    required(
      route.entry !== null &&
        route.args[0] === "--input-type=module" &&
        route.args[1] === "-e" &&
        typeof route.args[2] === "string",
      "unknown configured inline Node route"
    );
  else
    required(
      route.args.length === 2 && route.args[0] === "-c",
      "unknown configured native shell route"
    );
  required(
    route.configuration &&
      typeof route.configuration === "object" &&
      !Array.isArray(route.configuration) &&
      Object.keys(route.configuration).length > 0 &&
      Object.keys(route.configuration).length <= 16,
    "configured command authority is missing or unbounded"
  );
  required(
    route.environment &&
      typeof route.environment === "object" &&
      !Array.isArray(route.environment) &&
      Object.keys(route.environment).length <= 64 &&
      typeof route.environment.PATH === "string",
    "configured environment is unresolved"
  );
  required(
    Object.entries(route.environment).every(
      ([name, value]) =>
        /^[A-Z][A-Z0-9_]*$/.test(name) &&
        typeof value === "string" &&
        !value.includes("\0") &&
        Buffer.byteLength(value) <= 4096
    ),
    "invalid configured environment tuple"
  );
}

/** Helper imports and every included configuration byte form one bounded current closure. */
export function controllerGraph(graph, routes = []) {
  required(
    Array.isArray(routes) && routes.length <= 64,
    "configured command inventory exceeds bound"
  );
  const expected = { ...graph };
  for (const route of routes) {
    configuredTuple(route, graph);
    for (const [path, hash] of Object.entries(route.configuration)) {
      required(
        path.startsWith("/") &&
          /^[a-f0-9]{64}$/.test(hash) &&
          (!Object.hasOwn(expected, path) || expected[path] === hash),
        "configured configuration graph differs"
      );
      expected[path] = hash;
    }
  }
  required(
    Object.keys(expected).length <= 128,
    "configured helper/configuration closure exceeds bound"
  );
  return expected;
}

/** Exact tuples cannot grant general eval or native shell authority to an unmatched invocation. */
export function configuredRoute(tool, args, routes, cwd, environment) {
  const matches = routes.filter(
    route =>
      route.tool === tool &&
      route.cwd === cwd &&
      canonicalJson(route.args) === canonicalJson(args)
  );
  required(matches.length <= 1, "ambiguous configured controller command");
  if (!matches.length) return false;
  required(
    ![
      "NODE_OPTIONS",
      "NODE_PATH",
      "ENV",
      "BASH_ENV",
      "LD_PRELOAD",
      "LD_LIBRARY_PATH",
      "RUBYOPT",
      "GIT_EXEC_PATH",
    ].some(name => environment[name]),
    "unqualified configured environment loader"
  );
  required(
    Object.entries(matches[0].environment).every(
      ([name, value]) => environment[name] === value
    ),
    "configured controller environment changed"
  );
  return true;
}

/** A publication has one full audit and one accurately observed destination stream. */
export function gateStreams(branch, commit, parent, destination) {
  required(
    /^lisa\/npm-[a-f0-9]{64}$/.test(branch) &&
      OBJECT.test(commit) &&
      OBJECT.test(parent),
    "invalid gated ref identity"
  );
  required(
    destination === null || destination === commit,
    "foreign publication destination"
  );
  const line = oid =>
    `refs/heads/${branch} ${commit} refs/heads/${branch} ${oid}\n`;
  return {
    audit: { kind: "full-proposal-audit", refs: line(parent), range: [commit] },
    destination: {
      kind:
        destination === null
          ? "absent-destination"
          : "existing-destination-no-op",
      refs: line(destination ?? "0".repeat(40)),
      range: destination === null ? [commit] : [],
    },
  };
}

/** Empty transport never supplies a full proposal audit or excuses a failed original gate. */
export function assertGateTransport(
  receipt,
  branch,
  commit,
  parent,
  destination
) {
  const streams = gateStreams(branch, commit, parent, destination);
  for (const role of ["audit", "destination"]) {
    const actual = receipt[role];
    required(
      actual?.exit === 0 &&
        actual.kind === streams[role].kind &&
        actual.refs === streams[role].refs &&
        canonicalJson(actual.range) === canonicalJson(streams[role].range),
      "original full audit or destination gate differs"
    );
  }
}

/** A no-op destination cannot substitute for an independently successful complete-range audit. */
export async function runGateStreams(
  branch,
  commit,
  parent,
  destination,
  execute
) {
  const streams = gateStreams(branch, commit, parent, destination);
  const receipt = {};
  for (const role of ["audit", "destination"]) {
    const result = await execute(streams[role].refs);
    required(
      result?.code === 0 &&
        Buffer.isBuffer(result.stdout) &&
        Buffer.isBuffer(result.stderr),
      `ordinary ${role} gate failed or native result is invalid`
    );
    receipt[role] = {
      ...streams[role],
      exit: result.code,
      logSha256: sha256(Buffer.concat([result.stdout, result.stderr])),
    };
  }
  assertGateTransport(receipt, branch, commit, parent, destination);
  return receipt;
}
