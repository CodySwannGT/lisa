/** Fixed bounded first-write/refresh transaction; no generic filesystem writer. */
import {
  existsSync,
  lstatSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { AccessFailure, plainObject } from "./config-layers.mjs";
import { configuredRef } from "./task-intake.mjs";
const fail = () => {
  throw new AccessFailure("requirements-stale");
};

/** The existing resolver contract permits only this one Git-private exclusion. */
function ensureIgnored(root) {
  const ignored = () => {
    try {
      execFileSync(
        "git",
        ["check-ignore", "-q", ".lisa/work-item-context.md"],
        { cwd: root, stdio: "ignore", timeout: 5000 }
      );
      return true;
    } catch (error) {
      if (error.status === 1) return false;
      fail();
    }
  };
  if (ignored()) return;
  let path;
  try {
    path = resolve(
      root,
      execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      }).trim()
    );
  } catch {
    fail();
  }
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) fail();
  } catch (error) {
    if (error.code !== "ENOENT") fail();
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(path, "\n.lisa/work-item-context.md\n", { mode: 0o600 });
  if (!ignored()) fail();
}

/** Canonical bounded preclaim metadata transaction. No product/source write. */
export function writeRequirementsContext(
  cfg,
  ref,
  input,
  binding,
  createContext,
  marker
) {
  if (
    !plainObject(input) ||
    Object.keys(input).some(
      k =>
        !["required_access", "requirements_complete", "context_body"].includes(
          k
        )
    ) ||
    input.requirements_complete !== true
  )
    fail();
  if (!configuredRef(cfg, ref) || (binding && binding.ref !== ref)) fail();
  const path = join(cfg.projectRoot, ".lisa/work-item-context.md");
  let initial = false;
  try {
    lstatSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") fail();
    initial = true;
  }
  if (initial) {
    if (
      typeof input.context_body !== "string" ||
      input.context_body.startsWith(marker)
    )
      fail();
  } else {
    try {
      if (realpathSync(path) !== path || input.context_body !== undefined)
        fail();
    } catch {
      fail();
    }
  }
  const eas = join(cfg.projectRoot, ".easignore");
  if (
    existsSync(eas) &&
    !readFileSync(eas, "utf8")
      .split(/\r?\n/)
      .includes(".lisa/work-item-context.md")
  )
    fail();
  ensureIgnored(cfg.projectRoot);
  let body = initial ? input.context_body : readFileSync(path, "utf8");
  if (body.startsWith(marker)) {
    const end = body.indexOf("\n-->\n");
    if (end < 0) fail();
    let old;
    try {
      old = JSON.parse(body.slice(marker.length, end));
    } catch {
      fail();
    }
    if (old.work_item_ref !== ref) fail();
    body = body.slice(end + 5);
  }
  const content = createContext(
    cfg,
    ref,
    cfg.effective.tracker ??
      binding?.provider ??
      (ref?.includes("#") ? "github" : undefined),
    input.required_access,
    body
  );
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    if (initial) {
      const directory = dirname(path);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (realpathSync(directory) !== directory) fail();
    }
    writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return { code: "requirements-prepared", body_preserved: true };
}
