/** Inert CommonJS programs executed in kernel-bound scratch cwd handles. */
/** Exit status used when the child cwd does not match the expected inode. */
const BOUND_CLEANUP_IDENTITY_EXIT = 73;

/** Synchronous deletion program whose cwd is bound before traversal. */
export const BOUND_DIRECTORY_CLEANUP_PROGRAM = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const expectedDev = process.argv[1];
const expectedIno = process.argv[2];
const root = fs.lstatSync(".");
if (!root.isDirectory() || root.isSymbolicLink() || String(root.dev) !== expectedDev || String(root.ino) !== expectedIno) {
  process.stderr.write("scratch directory identity changed before bound cleanup\n");
  process.exit(${String(BOUND_CLEANUP_IDENTITY_EXIT)});
}
const deadline = Date.now() + 30000;
let entries = 0;
const readChildren = candidate => {
  const handle = fs.opendirSync(candidate);
  const names = [];
  try {
    for (;;) {
      const entry = handle.readSync();
      if (entry === null) break;
      if (Buffer.byteLength(entry.name, "utf8") > 1024) throw new Error("scratch cleanup basename exceeds 1024 bytes");
      entries += 1;
      if (entries > 100000) throw new Error("scratch cleanup entry bound exceeded");
      names.push(entry.name);
    }
  } finally {
    handle.closeSync();
  }
  return names;
};
const pending = [{ candidate: ".", depth: 0 }];
const scanned = [];
while (pending.length > 0) {
  if (Date.now() > deadline) throw new Error("scratch cleanup time bound exceeded");
  const item = pending.pop();
  if (item.depth > 128) throw new Error("scratch cleanup depth bound exceeded");
  let stat;
  try {
    stat = fs.lstatSync(item.candidate);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  if (item.candidate !== ".") {
    scanned.push({ candidate: item.candidate, depth: item.depth, dev: String(stat.dev), ino: String(stat.ino), directory: stat.isDirectory(), symlink: stat.isSymbolicLink() });
  }
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    for (const child of readChildren(item.candidate)) {
      pending.push({ candidate: path.join(item.candidate, child), depth: item.depth + 1 });
    }
  }
}
scanned.sort((left, right) => right.depth - left.depth);
for (const item of scanned) {
  let stat;
  try {
    stat = fs.lstatSync(item.candidate);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  if (String(stat.dev) !== item.dev || String(stat.ino) !== item.ino || stat.isDirectory() !== item.directory || stat.isSymbolicLink() !== item.symlink) {
    process.stderr.write("scratch entry identity changed before bound cleanup: " + item.candidate + "\n");
    process.exit(${String(BOUND_CLEANUP_IDENTITY_EXIT)});
  }
  try {
    if (item.directory && !item.symlink) fs.rmdirSync(item.candidate);
    else fs.unlinkSync(item.candidate);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
`;

/** Parent-cwd-bound program removing every preclassified direct child. */
export const BOUND_CHILDREN_CLEANUP_PROGRAM = String.raw`
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const expectedDev = process.argv[1];
const expectedIno = process.argv[2];
const parent = fs.lstatSync(".");
if (!parent.isDirectory() || parent.isSymbolicLink() || String(parent.dev) !== expectedDev || String(parent.ino) !== expectedIno) {
  process.stderr.write("scratch parent identity changed before bound cleanup\n");
  process.exit(${String(BOUND_CLEANUP_IDENTITY_EXIT)});
}
const items = JSON.parse(fs.readFileSync(0, "utf8"));
const deadline = Date.now() + 30000;
let entries = 0;
const readChildren = candidate => {
  const handle = fs.opendirSync(candidate);
  const names = [];
  try {
    for (;;) {
      const entry = handle.readSync();
      if (entry === null) break;
      if (Buffer.byteLength(entry.name, "utf8") > 1024) throw new Error("scratch cleanup basename exceeds 1024 bytes");
      entries += 1;
      if (entries > 100000) throw new Error("scratch cleanup entry bound exceeded");
      names.push(entry.name);
    }
  } finally {
    handle.closeSync();
  }
  return names;
};
const scanDirectory = rootName => {
  const pending = [{ candidate: rootName, relative: "", depth: 0 }];
  const scanned = [];
  while (pending.length > 0) {
    if (Date.now() > deadline) throw new Error("scratch cleanup time bound exceeded");
    const item = pending.pop();
    if (item.depth > 128) throw new Error("scratch cleanup depth bound exceeded");
    let stat;
    try {
      stat = fs.lstatSync(item.candidate);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (item.relative !== "") {
      scanned.push({ relative: item.relative, depth: item.depth, dev: String(stat.dev), ino: String(stat.ino), directory: stat.isDirectory(), symlink: stat.isSymbolicLink() });
    }
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const child of readChildren(item.candidate)) {
        pending.push({ candidate: path.join(item.candidate, child), relative: item.relative === "" ? child : path.join(item.relative, child), depth: item.depth + 1 });
      }
    }
  }
  return scanned;
};
const prepared = [];
for (const item of items) {
  if (typeof item.basename !== "string" || item.basename === "" || path.basename(item.basename) !== item.basename || Buffer.byteLength(item.basename, "utf8") > 1024) {
    throw new Error("scratch cleanup candidate must be a bounded direct basename");
  }
  let before;
  try {
    before = fs.lstatSync(item.basename);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  if (String(before.dev) !== item.dev || String(before.ino) !== item.ino || before.isDirectory() !== item.directory || before.isSymbolicLink() !== item.symlink) {
    process.stderr.write("scratch child identity changed before bound cleanup: " + item.basename + "\n");
    process.exit(${String(BOUND_CLEANUP_IDENTITY_EXIT)});
  }
  prepared.push({ item });
}
for (const preparedItem of prepared) {
  const item = preparedItem.item;
  let before;
  try {
    before = fs.lstatSync(item.basename);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  if (String(before.dev) !== item.dev || String(before.ino) !== item.ino || before.isDirectory() !== item.directory || before.isSymbolicLink() !== item.symlink) {
    process.stderr.write("scratch child identity changed before quarantine: " + item.basename + "\n");
    process.exit(${String(BOUND_CLEANUP_IDENTITY_EXIT)});
  }
  // Deterministic seam for the scan-after-quarantine control, in the shape the
  // rest of this subsystem already uses for protocol faults. It writes only
  // inside a child already authorized for deletion, and only under an explicit
  // environment opt-in, so it cannot fire in a real run.
  if (process.env.LISA_TEST_SCRATCH_CLEANUP_FAULT === "write-before-quarantine" && item.directory && !item.symlink) {
    fs.writeFileSync(path.join(item.basename, "late-writer.txt"), "late");
  }
  const quarantine = ".lisa-child-quarantine-" + crypto.randomBytes(16).toString("hex");
  fs.renameSync(item.basename, quarantine);
  const quarantined = fs.lstatSync(quarantine);
  if (String(quarantined.dev) !== item.dev || String(quarantined.ino) !== item.ino) {
    process.stderr.write("scratch child identity changed during quarantine: " + item.basename + "\n");
    process.exit(${String(BOUND_CLEANUP_IDENTITY_EXIT)});
  }
  if (item.directory && !item.symlink) {
    // Scanned AFTER the quarantine rename, never before it. A pre-rename scan
    // leaves a window in which a writer creates an entry that is therefore
    // absent from the recorded list, never deleted, and left to fail the final
    // rmdirSync with ENOTEMPTY -- so the cleanup that exists to remove a tree
    // leaves the whole quarantined tree behind. After the rename the directory
    // sits at an unguessable name no other writer holds a path to, so what is
    // scanned here is what is there.
    const scanned = scanDirectory(quarantine).sort((left, right) => right.depth - left.depth);
    for (const child of scanned) {
      const candidate = path.join(quarantine, child.relative);
      let stat;
      try {
        stat = fs.lstatSync(candidate);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (String(stat.dev) !== child.dev || String(stat.ino) !== child.ino || stat.isDirectory() !== child.directory || stat.isSymbolicLink() !== child.symlink) {
        process.stderr.write("scratch descendant identity changed during bound cleanup: " + item.basename + "\n");
        process.exit(${String(BOUND_CLEANUP_IDENTITY_EXIT)});
      }
      try {
        if (child.directory && !child.symlink) fs.rmdirSync(candidate);
        else fs.unlinkSync(candidate);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const after = fs.lstatSync(quarantine);
    if (String(after.dev) !== item.dev || String(after.ino) !== item.ino) {
      process.stderr.write("scratch child identity changed during bound cleanup: " + item.basename + "\n");
      process.exit(${String(BOUND_CLEANUP_IDENTITY_EXIT)});
    }
    fs.rmdirSync(quarantine);
  } else {
    fs.unlinkSync(quarantine);
  }
}
`;
