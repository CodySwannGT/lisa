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

/** Only bounded regular committed records can supply literal batch object IDs. */
function committedRecords(tree) {
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
  if (records.length > 2000) throw new Error("unbounded diagnostic inventory");
  return records
    .map(record => /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(record))
    .filter(match => match && specPath(match[3]));
}

/** Exact ordered headers, body lengths and LF trailers refuse missing, extra or substituted blobs. */
function batchLines(output, objects) {
  if (!Buffer.isBuffer(output)) throw new Error("invalid diagnostic batch");
  const blobs = new Map();
  let offset = 0,
    bytes = 0;
  for (const object of objects) {
    const end = output.indexOf(10, offset);
    if (end < offset || end - offset > 64)
      throw new Error("invalid diagnostic batch header");
    const header = /^([a-f0-9]{40}) blob (0|[1-9]\d{0,6})$/.exec(
      output.toString("utf8", offset, end)
    );
    if (!header || header[1] !== object)
      throw new Error("diagnostic batch object differs");
    const size = Number(header[2]);
    bytes += size;
    if (size > 1_048_576 || bytes > 8_388_608)
      throw new Error("unbounded diagnostic blob");
    const start = end + 1,
      trailer = start + size;
    if (trailer >= output.length || output[trailer] !== 10)
      throw new Error("incomplete diagnostic blob");
    let lines = size && output[trailer - 1] !== 10 ? 1 : 0;
    for (let index = start; index < trailer; index++)
      if (output[index] === 10) lines++;
    blobs.set(object, lines);
    offset = trailer + 1;
  }
  if (offset !== output.length)
    throw new Error("extra diagnostic batch output");
  return blobs;
}

/** One literal batch reads only captured committed IDs; diagnostic refusal changes no gate status. */
export async function captureCommittedSpecInventory(command, parent) {
  const token = Object.freeze({});
  let entries = new Map();
  try {
    if (
      typeof command !== "function" ||
      typeof parent !== "string" ||
      !OBJECT.test(parent)
    )
      throw new Error("invalid diagnostic input");
    const records = committedRecords(
      (await command(["ls-tree", "-r", "-z", parent, "--", "spec"])).stdout
    );
    const objects = [...new Set(records.map(record => record[2]))];
    const blobs = objects.length
      ? batchLines(
          (await command(["cat-file", "--batch"], `${objects.join("\n")}\n`))
            .stdout,
          objects
        )
      : new Map();
    for (const record of records)
      entries.set(record[3], { path: record[3], lines: blobs.get(record[2]) });
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
