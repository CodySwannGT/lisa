// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-rspec-reports.mjs
 * @description Committed source selects bounded child-reported pointers, never failure authority.
 * @module npm-updater
 */
const catalogs = new WeakMap();
const OBJECT = /^[a-f0-9]{40}$/;

/** Canonical ASCII paths cannot add separators or controls to the public diagnostic. */
function specPath(path) {
  return (
    typeof path === "string" &&
    path.length <= 240 &&
    /^spec\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.rb$/.test(path) &&
    path.split("/").every(part => part !== "." && part !== "..")
  );
}

/** Only captured regular committed blobs are read; a diagnostic failure never changes gate execution. */
export async function captureCommittedSpecInventory(command, parent) {
  const token = Object.freeze({});
  let entries = new Map();
  try {
    if (typeof parent !== "string" || !OBJECT.test(parent))
      throw new Error("invalid diagnostic parent");
    const tree = (await command(["ls-tree", "-r", "-z", parent, "--", "spec"]))
      .stdout;
    if (
      !Buffer.isBuffer(tree) ||
      tree.length > 1_048_576 ||
      (tree.length && tree.at(-1) !== 0)
    )
      throw new Error("unbounded diagnostic inventory");
    const records = new TextDecoder("utf8", { fatal: true })
      .decode(tree)
      .split("\0")
      .filter(Boolean);
    if (records.length > 2000)
      throw new Error("unbounded diagnostic inventory");
    const blobs = new Map();
    let bytes = 0;
    for (const record of records) {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(record);
      if (!match || !specPath(match[3])) continue;
      if (!blobs.has(match[2])) {
        const blob = (await command(["cat-file", "blob", match[2]])).stdout;
        if (
          !Buffer.isBuffer(blob) ||
          blob.length > 1_048_576 ||
          (bytes += blob.length) > 8_388_608
        )
          throw new Error("unbounded diagnostic blob");
        let lines = blob.length && blob.at(-1) !== 10 ? 1 : 0;
        for (const byte of blob) if (byte === 10) lines++;
        blobs.set(match[2], lines);
      }
      entries.set(match[3], { path: match[3], lines: blobs.get(match[2]) });
    }
  } catch {
    entries = new Map();
  }
  catalogs.set(token, entries);
  return token;
}

/** Footer grammar discards descriptions and returns source-owned path strings only. */
function failedLocations(buffers, inventory, counts) {
  const catalog = catalogs.get(inventory);
  const locations = new Set();
  let truncated = false;
  if (catalog && counts?.failures > 0)
    for (const buffer of buffers) {
      let footer = false;
      for (const line of buffer.toString("utf8").split(/\r?\n/)) {
        if (line === "Failed examples:") {
          footer = true;
          continue;
        }
        if (!footer || line === "") continue;
        if (!line.startsWith("rspec ")) {
          footer = false;
          continue;
        }
        const match =
          /^rspec \.\/(spec\/[A-Za-z0-9_./-]+\.rb):([1-9]\d{0,5}) # [^\r\n]*$/.exec(
            line
          );
        if (!match || !specPath(match[1])) continue;
        const source = catalog.get(match[1]);
        if (!source || Number(match[2]) > source.lines) continue;
        const location = `${source.path}:${Number(match[2])}`;
        if (locations.has(location)) continue;
        if (locations.size === 20) {
          truncated = true;
          break;
        }
        locations.add(location);
      }
      if (truncated) break;
    }
  return {
    locations: [...locations],
    truncated,
  };
}

const hookNames = new Set([
  "work-item",
  "behavior-contract",
  "rspec",
  "brakeman",
  "reek",
  "flog",
  "flay",
  "mutation",
  "rubocop",
  "bundler-audit",
  "threshold-ratchet",
]);

/** Child reports are bounded hints, never native status, hook authority or raw output. */
export function hookReports(stdout, stderr, inventory) {
  const buffers = [stdout, stderr].filter(Buffer.isBuffer);
  if (buffers.reduce((size, buffer) => size + buffer.length, 0) > 8_388_608)
    return { hooks: [], counts: null, locations: [], truncated: false };
  const text = buffers
    .map(buffer => buffer.toString("utf8"))
    .join("\n")
    .replace(/\u001b\[[0-9;]{1,24}m/g, "");
  const hooks = new Set();
  for (const match of text.matchAll(
    /^[ \t]*❌ ([a-z][a-z-]{0,31})( \([\d. a-z]{1,16}\))?[ \t]*\r?$/gm
  ))
    if (
      hookNames.has(match[1]) &&
      (match[2] === undefined ||
        /^ \(\d{1,4}(?:\.\d{1,3})? (?:seconds?|s)\)$/.test(match[2]))
    )
      hooks.add(match[1]);
  const counts = new Map();
  for (const match of text.matchAll(
    /^[ \t]*(\d{1,6}) examples?, (\d{1,6}) failures?[ \t]*\r?$/gm
  )) {
    const examples = Number(match[1]);
    const failures = Number(match[2]);
    if (failures <= examples)
      counts.set(`${examples}:${failures}`, { examples, failures });
  }
  const count = counts.size === 1 ? counts.values().next().value : null;
  return {
    hooks: [...hooks].sort(),
    counts: count,
    ...failedLocations(buffers, inventory, count),
  };
}
