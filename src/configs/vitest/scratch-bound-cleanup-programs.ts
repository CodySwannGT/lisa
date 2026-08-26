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
const stack = fs.readdirSync(".").map(name => ({ candidate: name, depth: 1, visited: false, counted: false }));
let entries = 0;
while (stack.length > 0) {
  if (Date.now() > deadline) throw new Error("scratch cleanup time bound exceeded");
  const item = stack.pop();
  if (!item.counted) {
    entries += 1;
    if (entries > 100000) throw new Error("scratch cleanup entry bound exceeded");
  }
  if (item.depth > 128) throw new Error("scratch cleanup depth bound exceeded");
  let stat;
  try {
    stat = fs.lstatSync(item.candidate);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    try {
      fs.unlinkSync(item.candidate);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    continue;
  }
  if (item.visited) {
    try {
      fs.rmdirSync(item.candidate);
    } catch (error) {
      if (error.code === "ENOTEMPTY") {
        stack.push({ ...item, visited: false, counted: true });
      } else if (error.code !== "ENOENT") {
        throw error;
      }
    }
    continue;
  }
  stack.push({ ...item, visited: true, counted: true });
  let children;
  try {
    children = fs.readdirSync(item.candidate);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  for (const child of children) {
    stack.push({ candidate: path.join(item.candidate, child), depth: item.depth + 1, visited: false, counted: false });
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
const clearDirectory = rootName => {
  const stack = fs.readdirSync(rootName).map(name => ({ candidate: path.join(rootName, name), depth: 1, visited: false, counted: false }));
  while (stack.length > 0) {
    if (Date.now() > deadline) throw new Error("scratch cleanup time bound exceeded");
    const item = stack.pop();
    if (!item.counted) {
      entries += 1;
      if (entries > 100000) throw new Error("scratch cleanup entry bound exceeded");
    }
    if (item.depth > 128) throw new Error("scratch cleanup depth bound exceeded");
    let stat;
    try {
      stat = fs.lstatSync(item.candidate);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      try {
        fs.unlinkSync(item.candidate);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      continue;
    }
    if (item.visited) {
      try {
        fs.rmdirSync(item.candidate);
      } catch (error) {
        if (error.code === "ENOTEMPTY") stack.push({ ...item, visited: false, counted: true });
        else if (error.code !== "ENOENT") throw error;
      }
      continue;
    }
    stack.push({ ...item, visited: true, counted: true });
    let children;
    try {
      children = fs.readdirSync(item.candidate);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const child of children) {
      stack.push({ candidate: path.join(item.candidate, child), depth: item.depth + 1, visited: false, counted: false });
    }
  }
};
for (const item of items) {
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
  const quarantine = ".lisa-child-quarantine-" + crypto.randomBytes(16).toString("hex");
  fs.renameSync(item.basename, quarantine);
  const quarantined = fs.lstatSync(quarantine);
  if (String(quarantined.dev) !== item.dev || String(quarantined.ino) !== item.ino) {
    process.stderr.write("scratch child identity changed during quarantine: " + item.basename + "\n");
    process.exit(${String(BOUND_CLEANUP_IDENTITY_EXIT)});
  }
  if (item.directory && !item.symlink) {
    clearDirectory(quarantine);
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
