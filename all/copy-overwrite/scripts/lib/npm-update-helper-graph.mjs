// This file is managed by Lisa. Durable changes belong upstream.
/** Fixed authenticated data qualifies complete import and canonical-child closures without evaluating source. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isBuiltin } from "node:module";
import { posix } from "node:path";

const COMMON = [
  "lisa-work-item.mjs",
  "lisa-automation-provenance.mjs",
  "lisa-rails-prepush.mjs",
  "lisa-history-secrets.mjs",
  "lisa-gates.mjs",
  "lisa-run-gates.mjs",
  "lisa-commit-msg-gates.mjs",
  "lisa-test-node.mjs",
  "lib/invoked-as-script.mjs",
  "lib/bounded-spawn.mjs",
  "lib/process-tree-runner.mjs",
  "lib/windows-process-job.mjs",
  "lib/windows-process-job.ps1",
  "lib/windows-process-job.cs",
  "lib/kill-marks.mjs",
  "lib/gate-failure-diagnosis.mjs",
  "lib/worktree-dependencies.mjs",
  "lib/history-secret-git.mjs",
  "lib/history-secret-scanner.mjs",
  "lib/history-secret-policy.mjs",
  "lib/github-attestation-verifier.mjs",
  "lib/github-attestation-provider.mjs",
  "lib/github-attestation-recovery.mjs",
  "lib/automation-provenance-contract.mjs",
  "lib/automation-provenance-local.mjs",
];
const RAILS = [
  "lisa-clean-git-env.sh",
  "lisa-scratch-run.sh",
  "check-threshold-ratchet.mjs",
  "threshold-ratchet-families.mjs",
  "threshold-ratchet-compare.mjs",
];
const PRODUCER = [
  "allocate",
  "authorization",
  "checkpoint",
  "contract",
  "execution-adapter",
  "gate-hooks",
  "gate-install",
  "gate",
  "github",
  "helper",
  "helper-graph",
  "invariants",
  "isolation",
  "leaf",
  "leaf-contract",
  "npm",
  "object",
  "orchestrator",
  "owner",
  "prepare",
  "process",
  "process-core",
  "publication",
  "publish",
  "quality",
  "recovery",
  "runtime-archive",
  "runtime-graph",
  "runtime-transport",
  "runtime",
  "tool-launcher",
  "worker-environment",
  "worker-inspection",
  "worker-lifecycle",
  "worker-policy",
];
const CONTROLS = [
  "lib/npm-update-helper-graph.mjs",
  "npm-updater-helper-graph.json",
];
const PACKAGE = [
  "package/plugins/lisa/scripts/intake-blocker-reprobe.mjs",
  "package/plugins/lisa/scripts/intake-prework-denominator.mjs",
];

/** Only reviewed upstream templates and fixed classifier package members can enter the inventory. */
export function managedTemplateMembers() {
  return new Map([
    ...[
      ...COMMON,
      "lisa-npm-updater.mjs",
      "npm-updater-helper-graph.json",
      "npm-updater-gate-runtime.json",
      "npm-updater-gate-supervisor.c",
      "npm-updater-gate.Dockerfile",
      ...PRODUCER.map(name => `lib/npm-update-${name}.mjs`),
    ].map(member => [member, `all/copy-overwrite/scripts/${member}`]),
    ...RAILS.map(member => [member, `rails/copy-overwrite/scripts/${member}`]),
    ["lisa-mutation.sh", "rails/copy-contents/scripts/lisa-mutation.sh"],
  ]);
}

/** Relative normalized names never authorize traversal, URLs, absolute paths or unknown helpers. */
function memberPath(member) {
  assert(
    typeof member === "string" &&
      member.length <= 256 &&
      member === posix.normalize(member) &&
      !member.startsWith("/") &&
      !member.split("/").includes("..") &&
      !/[\\\0\n]/.test(member) &&
      (managedTemplateMembers().has(member) || PACKAGE.includes(member)),
    "helper path is outside the fixed inventory"
  );
}

function fields(value, expected) {
  assert(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).sort().join("\n") === [...expected].sort().join("\n"),
    "helper graph schema differs"
  );
}

/** Every declared edge is finite, unique and points to a builtin or another fixed member. */
function edges(record, field) {
  const values = record[field];
  assert(
    Array.isArray(values) &&
      values.length <= 64 &&
      new Set(values).size === values.length,
    "helper edges are ambiguous or unbounded"
  );
  for (const value of values) {
    if (
      field !== "children" &&
      typeof value === "string" &&
      value.startsWith("node:") &&
      isBuiltin(value)
    )
      continue;
    memberPath(value);
  }
  return values.filter(value => !value.startsWith("node:"));
}

/**
 * @typedef {{staticImports: string[], dynamicImports: string[], children: string[]}} HelperEdges
 * @typedef {HelperEdges & {sha256: string}} HelperMember
 * @typedef {{version: 1, controls: Record<string, HelperEdges>, members: Record<string, HelperMember>}} HelperManifest
 */

/**
 * SHA256 binds static, literal dynamic and canonical subprocess edges to the actual audited source.
 * @returns {HelperManifest} The closed validated manifest.
 */
export function validateHelperManifest(manifest) {
  fields(manifest, ["version", "controls", "members"]);
  assert(manifest.version === 1, "unsupported helper graph version");
  const names = Object.keys(manifest.members ?? {});
  assert(
    names.length > 0 && names.length <= 128,
    "helper member inventory is empty or unbounded"
  );
  for (const name of names) {
    memberPath(name);
    const record = manifest.members[name];
    fields(record, ["sha256", "staticImports", "dynamicImports", "children"]);
    assert(
      /^[a-f0-9]{64}$/.test(record.sha256),
      "helper source hash is invalid"
    );
    for (const field of ["staticImports", "dynamicImports", "children"])
      edges(record, field);
  }
  assert(
    manifest.controls &&
      typeof manifest.controls === "object" &&
      !Array.isArray(manifest.controls),
    "helper control inventory differs"
  );
  for (const [name, record] of Object.entries(manifest.controls)) {
    assert(
      CONTROLS.includes(name) && !Object.hasOwn(manifest.members, name),
      "unknown or overlapping helper control"
    );
    fields(record, ["staticImports", "dynamicImports", "children"]);
    for (const field of ["staticImports", "dynamicImports", "children"])
      edges(record, field);
  }
  return manifest;
}

/** Independently authenticated control/manifest bytes avoid an impossible self-inclusive source hash. */
export function helperManifest(bytes) {
  assert(
    Buffer.isBuffer(bytes) && bytes.length <= 262_144,
    "helper manifest is unbounded"
  );
  const text = new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(
    bytes
  );
  const manifest = validateHelperManifest(JSON.parse(text));
  assert(
    text === `${JSON.stringify(manifest, null, 2)}\n`,
    "helper manifest is not canonical readable JSON"
  );
  assert(
    Object.keys(manifest.controls).sort().join("\n") ===
      [...CONTROLS].sort().join("\n"),
    "independent helper controls are incomplete"
  );
  return manifest;
}

/** A controller manifest covers the whole fixed inventory; omitted unrelated members cannot mask drift. */
export function controllerMembers(manifest) {
  validateHelperManifest(manifest);
  const expected = [...managedTemplateMembers().keys(), ...PACKAGE].filter(
    member => !CONTROLS.includes(member)
  );
  assert(
    Object.keys(manifest.members).sort().join("\n") ===
      expected.sort().join("\n"),
    "controller helper manifest inventory is incomplete"
  );
  return [...expected, ...CONTROLS];
}

/** This pure check never grants authority; callers authenticate every buffer from one pinned owner first. */
function checkedClosure(manifest, authenticated, entries) {
  validateHelperManifest(manifest);
  const selected = new Set();
  const visit = name => {
    memberPath(name);
    if (selected.has(name)) return;
    const record = manifest.members[name] ?? manifest.controls[name];
    assert(record, "helper entry is outside the manifest inventory");
    const bytes = authenticated.get(name);
    assert(
      Buffer.isBuffer(bytes) && bytes.length <= 1_048_576,
      "authenticated helper member is missing or unbounded"
    );
    if (record.sha256)
      assert(
        createHash("sha256").update(bytes).digest("hex") === record.sha256,
        "authenticated helper source hash changed"
      );
    selected.add(name);
    for (const field of ["staticImports", "dynamicImports", "children"])
      for (const child of edges(record, field)) visit(child);
  };
  for (const entry of entries) visit(entry);
  return [...selected].sort();
}

/** The external selector remains bounded independently of the fixed authority inventory. */
export function assertManagedSelection(entries) {
  assert(
    Array.isArray(entries) &&
      entries.length > 0 &&
      entries.length <= 64 &&
      new Set(entries).size === entries.length,
    "helper selection is ambiguous"
  );
}

/** External callers select at most64 unique roots; fixed control nodes do not consume that budget. */
export function managedClosure(manifest, authenticated, entries) {
  assertManagedSelection(entries);
  assert(authenticated instanceof Map, "helper selection is ambiguous");
  return checkedClosure(manifest, authenticated, entries);
}

/** Fixed control authority accompanies a bounded caller's complete selected closure. */
export function managedControllerSelection(manifest, authenticated, entries) {
  return [
    ...new Set([
      ...managedClosure(manifest, authenticated, entries),
      ...CONTROLS,
    ]),
  ];
}

/** Complete authority audit accepts exactly the fixed inventory, never an expanded caller selector. */
export function auditControllerClosure(manifest, authenticated) {
  const members = controllerMembers(manifest);
  assert(
    authenticated instanceof Map &&
      authenticated.size === members.length &&
      [...authenticated.keys()].every(member => members.includes(member)),
    "complete authenticated controller inventory differs"
  );
  return checkedClosure(manifest, authenticated, members);
}
