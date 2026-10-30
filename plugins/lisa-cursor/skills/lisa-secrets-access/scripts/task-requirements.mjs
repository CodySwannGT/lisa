/** Requirements-only intake header. No stored decision can authorize access. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
  rmSync,
  statSync,
  lstatSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { AccessFailure, plainObject } from "./config-layers.mjs";
import { writeRequirementsContext } from "./task-context-write.mjs";

export const REQUIREMENTS_HEADER = "<!-- lisa-required-access:v1\n";
export const digest = value => createHash("sha256").update(value).digest("hex");
const stable = value =>
  Array.isArray(value)
    ? value.map(stable)
    : plainObject(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map(k => [k, stable(value[k])])
        )
      : value;
export const configDigest = cfg =>
  digest(
    JSON.stringify(
      stable({
        effective: cfg.effective,
        root: cfg.projectRoot,
        provenance: cfg.provenance,
        surface: cfg.surface,
        provider: cfg.provider,
        namespace: cfg.namespace,
        bootstrap: cfg.bootstrap,
      })
    )
  );
const fields = [
  "schema",
  "work_item_ref",
  "tracker",
  "project_root",
  "context_sha256",
  "effective_config_sha256",
  "surface",
  "requirements_complete",
  "required_access",
  "requirements_sha256",
];
const entryFields = [
  "id",
  "kind",
  "credential_names",
  "access_layer",
  "operation",
  "resource",
];
const fail = () => {
  throw new AccessFailure("requirements-stale");
};

/** Produce a leading requirements header while preserving every following byte. */
export function requirementsContext(cfg, ref, tracker, requiredAccess, body) {
  const header = {
    schema: 1,
    work_item_ref: ref,
    tracker,
    project_root: cfg.projectRoot,
    context_sha256: digest(body),
    effective_config_sha256: configDigest(cfg),
    surface: cfg.surface,
    requirements_complete: true,
    required_access: requiredAccess,
    requirements_sha256: digest(JSON.stringify(requiredAccess)),
  };
  validateHeader(header);
  return REQUIREMENTS_HEADER + JSON.stringify(header) + "\n-->\n" + body;
}

/** Canonical bounded preclaim metadata transaction. No product/source write. */
export function prepareRequirements(cfg, ref, input) {
  return writeRequirementsContext(
    cfg,
    ref,
    input,
    taskBinding(cfg.projectRoot),
    requirementsContext,
    REQUIREMENTS_HEADER
  );
}

function validateHeader(header) {
  if (
    !plainObject(header) ||
    Object.keys(header).length !== fields.length ||
    Object.keys(header).some(k => !fields.includes(k))
  )
    fail();
  if (
    header.schema !== 1 ||
    header.requirements_complete !== true ||
    !["github", "jira", "linear"].includes(header.tracker) ||
    typeof header.work_item_ref !== "string" ||
    !/^(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+|[A-Z][A-Z0-9]+-\d+)$/.test(
      header.work_item_ref
    )
  )
    fail();
  if (
    !Array.isArray(header.required_access) ||
    header.required_access.length > 100
  )
    fail();
  const ids = new Set();
  for (const r of header.required_access) {
    if (
      !plainObject(r) ||
      Object.keys(r).some(k => !entryFields.includes(k)) ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(r.id) ||
      ids.has(r.id) ||
      !["credential", "capability"].includes(r.kind)
    )
      fail();
    ids.add(r.id);
    if (
      !Array.isArray(r.credential_names) ||
      !r.credential_names.every(
        n => typeof n === "string" && /^[A-Z_][A-Z0-9_]{0,127}$/.test(n)
      )
    )
      fail();
    if (
      r.kind === "capability" &&
      (typeof r.access_layer !== "string" ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(r.access_layer) ||
        typeof r.operation !== "string" ||
        !/^[a-z][a-z0-9-]{0,63}$/.test(r.operation) ||
        typeof r.resource !== "string" ||
        r.resource.length > 256 ||
        /[\r\n\x00-\x1f]/.test(r.resource))
    )
      fail();
    if (
      r.kind === "credential" &&
      (r.access_layer !== undefined ||
        r.operation !== undefined ||
        r.resource !== undefined ||
        !r.credential_names.length)
    )
      fail();
  }
}

/** Read current canonical binding; it remains owned by lisa-work-item. */
export function taskBinding(root) {
  // Confirm positive repo-less absence before invoking a Git-only facility.
  let dir = root;
  for (;;) {
    try {
      statSync(join(dir, ".git"));
      break;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code)) fail();
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
  let path;
  try {
    path = execFileSync(
      "git",
      ["rev-parse", "--git-path", "lisa/work-item.json"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }
    ).trim();
  } catch (error) {
    // probe-direction: fail-closed — an unreadable binding is not no active task.
    throw new AccessFailure(
      error.code === "ENOENT" ? "tool-missing" : "requirements-stale"
    );
  }
  const absolute = join(root, path);
  const actual = path.startsWith("/") ? path : absolute;
  try {
    statSync(actual);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    fail();
  }
  try {
    const value = JSON.parse(readFileSync(actual, "utf8"));
    if (
      !plainObject(value) ||
      Object.keys(value).length !== 4 ||
      Object.keys(value).some(
        key => !["version", "provider", "ref", "branch"].includes(key)
      ) ||
      value.version !== 1 ||
      !["github", "linear", "jira"].includes(value.provider) ||
      typeof value.ref !== "string" ||
      !value.ref.length ||
      value.ref.length > 512 ||
      !(value.branch === null || typeof value.branch === "string")
    )
      fail();
    return value;
  } catch {
    fail();
  }
}

/** Recompute root/ref/config/surface/body/requirements equality on every action. */
export function readTaskRequirements(cfg, { ref, tracker, binding } = {}) {
  if (cfg.provenance?.status === "undiscovered")
    throw new AccessFailure("config-undiscovered");
  if (binding === undefined) binding = taskBinding(cfg.projectRoot);
  const path = join(cfg.projectRoot, ".lisa/work-item-context.md");
  if (!existsSync(path)) {
    if (binding || ref) fail();
    return null;
  }
  if (realpathSync(path) !== path) fail();
  const context = readFileSync(path, "utf8");
  if (!context.startsWith(REQUIREMENTS_HEADER)) fail();
  const end = context.indexOf("\n-->\n");
  if (end < 0 || end > 65536) fail();
  const raw = context.slice(REQUIREMENTS_HEADER.length, end);
  let header;
  try {
    header = JSON.parse(raw);
  } catch {
    fail();
  }
  validateHeader(header);
  // Canonical JSON also rejects duplicate keys and ambiguous alternate spellings.
  if (JSON.stringify(header) !== raw) fail();
  const body = context.slice(end + 5);
  if (body.startsWith(REQUIREMENTS_HEADER)) fail();
  if (
    header.project_root !== cfg.projectRoot ||
    header.context_sha256 !== digest(body) ||
    header.effective_config_sha256 !== configDigest(cfg) ||
    header.surface !== cfg.surface ||
    header.requirements_sha256 !==
      digest(JSON.stringify(header.required_access))
  )
    fail();
  if (
    (ref && header.work_item_ref !== ref) ||
    (tracker && header.tracker !== tracker) ||
    (cfg.effective?.tracker && header.tracker !== cfg.effective.tracker)
  )
    fail();
  if (cfg.effective?.github && header.tracker === "github") {
    const github = cfg.effective.github;
    const queue = github.queueRepo
      ? github.queueRepo.includes("/")
        ? github.queueRepo
        : `${github.org}/${github.queueRepo}`
      : `${github.org}/${github.repo}`;
    if (!header.work_item_ref.startsWith(`${queue}#`)) fail();
  }
  if (
    binding &&
    (binding.ref !== header.work_item_ref ||
      binding.provider !== header.tracker ||
      binding.version !== 1)
  )
    fail();
  return header;
}
