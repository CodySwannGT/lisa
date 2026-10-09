/**
 * @file preimage-batch.mjs
 * @description Independent bounded Git byte witnesses avoid one process pair per fixture tuple.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { validPreimageTuples } from "./errors.mjs";

// Match the fixture support resolver's fixed native candidates, keeping the
// developer-directory binary ahead of Apple's xcrun shim on macOS.
const gitBinary = [
  "/Library/Developer/CommandLineTools/usr/bin/git",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
  "/usr/bin/git",
  "/opt/homebrew/bin/git",
  "/usr/local/bin/git",
].find(candidate => existsSync(candidate));
const OBJECT_BYTES = 1024 * 1024;
const RAW_CHUNK_OBJECTS = 16;
const FRAME_BYTES = 256;
const unproved = () => {
  throw new Error("Unproved native preimage");
};

/**
 * Native reads retain the original per-object ceiling and finite fixture child lifetime.
 * @param args - Closed Git arguments from the verifier.
 * @param input - Original requested object identities, or no stdin.
 * @param maximum - Bounded raw output capacity derived from original object limits.
 * @returns Raw native Git bytes.
 */
const nativeGit = (args, input, maximum) =>
  execFileSync(gitBinary ?? unproved(), ["--no-replace-objects", ...args], {
    input,
    maxBuffer: maximum,
    timeout: 300000,
    killSignal: "SIGKILL",
  });

/**
 * Every returned tree row must identify one requested regular path in this exact revision.
 * @param raw - Actual native NUL-framed tree output.
 * @param paths - Original requested literal paths.
 * @param width - Original immutable commit identity width.
 * @returns Independently checked path/object identities.
 */
const treeEntries = (raw, paths, width) => {
  if (!raw.length || raw[raw.length - 1] !== 0) unproved();
  // Lossy decoding must never alias a malformed Git path to a requested one.
  const text = raw.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(raw)) unproved();
  const rows = text.slice(0, -1).split("\0");
  const entries = new Map();
  for (const row of rows) {
    const match = row.match(
      /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([^\0]*)$/u
    );
    if (
      !match ||
      match[2].length !== width ||
      !paths.has(match[3]) ||
      entries.has(match[3]) ||
      Buffer.byteLength(row) > OBJECT_BYTES
    )
      unproved();
    entries.set(match[3], match[2]);
  }
  if (entries.size !== paths.size) unproved();
  return entries;
};

/**
 * Group only original literal paths; exact coordinates decide proof.
 * @param tuples - Original validated closed native proof rows.
 * @param read - Bounded raw native Git reader.
 * @returns Checked native tree identities by original revision.
 */
const selectedTrees = (tuples, read) => {
  const selected = new Map();
  for (const [commit, path] of tuples) {
    if (!selected.has(commit)) selected.set(commit, new Set());
    selected.get(commit).add(path);
  }
  const trees = new Map();
  for (const [commit, paths] of selected) {
    const raw = read(
      ["--literal-pathspecs", "ls-tree", "-z", commit, "--", ...paths],
      undefined,
      paths.size * OBJECT_BYTES
    );
    trees.set(commit, treeEntries(raw, paths, commit.length));
  }
  return trees;
};

/**
 * Parse binary framing and independently authenticate every raw Git identity.
 * @param raw - Actual bounded native batch bytes.
 * @param requested - Original ordered full object identities.
 * @returns Authenticated original blob bytes by object identity.
 */
const rawObjects = (raw, requested) => {
  const objects = new Map();
  const cursor = { offset: 0 };
  for (const oid of requested) {
    const newline = raw.indexOf(10, cursor.offset);
    if (newline < 0 || newline - cursor.offset > FRAME_BYTES) unproved();
    const header = raw
      .subarray(cursor.offset, newline)
      // Latin-1 preserves high bits so the closed ASCII grammar rejects them.
      .toString("latin1")
      .match(/^([a-f0-9]{40}|[a-f0-9]{64}) blob (0|[1-9]\d*)$/u);
    if (!header || header[1] !== oid) unproved();
    const size = Number(header[2]);
    if (!Number.isSafeInteger(size) || size > OBJECT_BYTES) unproved();
    const start = newline + 1;
    const end = start + size;
    if (end >= raw.length || raw[end] !== 10) unproved();
    const bytes = raw.subarray(start, end);
    const identity = createHash(oid.length === 40 ? "sha1" : "sha256")
      .update(`blob ${size}\0`)
      .update(bytes)
      .digest("hex");
    if (identity !== oid) unproved();
    objects.set(oid, bytes);
    cursor.offset = end + 1;
  }
  if (cursor.offset !== raw.length) unproved();
  return objects;
};

/**
 * At most sixteen original one-MiB objects share a private pipe.
 * @param trees - Independently authenticated original native tree rows.
 * @param read - Bounded raw native Git reader.
 * @returns Checked original blob bytes, kept inside the fixture child.
 */
const selectedObjects = (trees, read) => {
  const identities = [
    ...new Set([...trees.values()].flatMap(tree => [...tree.values()])),
  ];
  const objects = new Map();
  const chunks = Array.from(
    { length: Math.ceil(identities.length / RAW_CHUNK_OBJECTS) },
    (_, index) =>
      identities.slice(
        index * RAW_CHUNK_OBJECTS,
        (index + 1) * RAW_CHUNK_OBJECTS
      )
  );
  for (const chunk of chunks) {
    const raw = read(
      ["cat-file", "--batch"],
      chunk.map(oid => `${oid}\n`).join(""),
      chunk.length * (OBJECT_BYTES + FRAME_BYTES)
    );
    for (const [oid, bytes] of rawObjects(raw, chunk)) objects.set(oid, bytes);
  }
  return objects;
};

/**
 * Verify every original closed tuple independently and return its original ordered native inventory.
 * Batching reduces fixture startup work while mode, path, object and expected byte hashes still decide proof.
 * @param tuples - Original at-most256 immutable commit/path/optional SHA256 records.
 * @param read - Native raw Git reader; fault controls alter genuine returned bytes only.
 * @returns Ordered original commit/path/object/size records, never raw preimages.
 */
export const verifyPreimageBatch = (tuples, read = nativeGit) => {
  if (
    !validPreimageTuples(tuples) ||
    tuples.some(
      ([, path]) => Buffer.from(path, "utf8").toString("utf8") !== path
    )
  )
    throw new Error("Invalid native preimage proof batch.");
  const trees = selectedTrees(tuples, read);
  const objects = selectedObjects(trees, read);
  return tuples.map(([commit, path, expected]) => {
    const oid = trees.get(commit).get(path);
    const bytes = objects.get(oid);
    if (
      !bytes ||
      (expected !== null &&
        createHash("sha256").update(bytes).digest("hex") !== expected)
    )
      unproved();
    return { commit, path, oid, size: bytes.length };
  });
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(verifyPreimageBatch(JSON.parse(process.argv[2])))
    );
  } catch {
    console.error(
      "Actual Git byte preimage witness failed; raw proof withheld."
    );
    process.exitCode = 1;
  }
}
