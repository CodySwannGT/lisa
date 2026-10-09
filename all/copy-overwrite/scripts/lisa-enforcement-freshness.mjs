// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Offline diagnostic evidence for the fallback, never an enforcement decision.
 * Open descriptors bound reads even if a path changes after the size check.
 * Missing Node/helper/evidence leaves Bash's initialized unknown verdicts.
 * @module scripts/lisa-enforcement-freshness
 */
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import path from "node:path";

const METADATA_LIMIT = 64 * 1024;
const RECORD_LIMIT = 4 * 1024 * 1024;
const GUARD_LIMIT = 1024 * 1024;
const GUARDS = new Set([
  "block-no-verify",
  "parity-safety-net",
  "block-shell-json-parsing",
  "block-instruction-file-edits",
  "block-direct-issue-create",
  "block-managed-file-edits",
  "block-blind-automerge",
  "worktree-binding-guard",
]);
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][A-Za-z0-9.-]{1,48})?$/u;

/** A finite regular, readable file, including when the caller is root. */
function readBounded(file, limit) {
  let fd;
  try {
    // Nonblocking open also prevents a substituted FIFO from stalling a notice.
    fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
    const before = fstatSync(fd);
    if (!before.isFile() || !(before.mode & 0o444) || before.size > limit)
      return null;
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    const after = fstatSync(fd);
    const current = statSync(file);
    if (
      length > limit ||
      length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      after.mode !== before.mode ||
      !current.isFile() ||
      !(current.mode & 0o444) ||
      current.size !== before.size ||
      current.mtimeMs !== before.mtimeMs ||
      current.ctimeMs !== before.ctimeMs ||
      current.mode !== before.mode ||
      current.dev !== before.dev ||
      current.ino !== before.ino
    )
      return null;
    return buffer.subarray(0, length);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Malformed, oversized, unreadable and non-object JSON all remain unknown. */
function json(file, limit = METADATA_LIMIT) {
  try {
    const bytes = readBounded(file, limit);
    const value =
      bytes === null
        ? null
        : JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function version(value) {
  return typeof value === "string" && VERSION.test(value) ? value : "";
}

function emit(key, value) {
  if (value) process.stdout.write(`${key}\t${value}\n`);
}

const [root, config, ...names] = process.argv.slice(2);
if (
  root &&
  config &&
  names.length <= GUARDS.size &&
  names.every(name => name === "" || GUARDS.has(name)) &&
  new Set(names.filter(Boolean)).size === names.filter(Boolean).length
) {
  const installedRoot = path.join(root, "node_modules/@codyswann/lisa");
  const installed = json(path.join(installedRoot, "package.json"));
  const installedVersion =
    installed?.name === "@codyswann/lisa" ? version(installed.version) : "";
  emit("installed", installedVersion);
  if (names.some(Boolean)) {
    const receipt = json(path.join(root, ".lisa/apply-receipt.json"));
    // Mirror readApplyReceipt's supported schema and required historical fields.
    // Optional fields do not make older supported receipts unusable.
    if (receipt?.schema_version === 1 && typeof receipt.applied_at === "string")
      emit("applied", version(receipt.lisa_version));
  }
  const plugin = json(
    path.join(root, "plugins/lisa/.claude-plugin/plugin.json")
  );
  emit("plugin", plugin?.name === "lisa" ? version(plugin.version) : "");
  const marketplace = json(
    path.join(
      config,
      "plugins/marketplaces/lisa/plugins/lisa/.claude-plugin/plugin.json"
    )
  );
  emit(
    "marketplace",
    marketplace?.name === "lisa" ? version(marketplace.version) : ""
  );

  // Eight pairs / sixteen MiB, plus one overflow-probe byte per file. Only
  // host-selected names are nonempty; plugin-selected guards are not compared.
  for (const [index, name] of names.entries()) {
    let state = "unknown";
    if (installedVersion && name) {
      const host = readBounded(
        path.join(root, "scripts/lisa-hooks", `${name}.sh`),
        GUARD_LIMIT
      );
      const template = readBounded(
        path.join(
          installedRoot,
          "all/copy-overwrite/scripts/lisa-hooks",
          `${name}.sh`
        ),
        GUARD_LIMIT
      );
      if (host !== null && template !== null)
        state = host.equals(template) ? "matching" : "different";
    }
    emit(`guard${index}`, state);
  }

  const record = json(
    path.join(config, "plugins/installed_plugins.json"),
    RECORD_LIMIT
  );
  const entries = record?.plugins?.["lisa@lisa"];
  if (Array.isArray(entries)) {
    const entry = entries.find(
      candidate =>
        candidate?.projectPath === root &&
        typeof candidate.installPath === "string" &&
        candidate.installPath.length <= 4096 &&
        !/[\x00-\x1f\x7f]/u.test(candidate.installPath) &&
        candidate.installPath.includes("/lisa/lisa/") &&
        version(candidate.version)
    );
    if (entry) {
      emit("channel", version(entry.version));
      emit("channel_path", entry.installPath);
    }
  }
  // Bash stages all facts until this terminal row and successful process exit;
  // a killed or failed helper must not lend authority to its earlier output.
  emit("complete", "1");
}
