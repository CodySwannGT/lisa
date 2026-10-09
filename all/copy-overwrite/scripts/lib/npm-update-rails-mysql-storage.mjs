// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Private file and inode authority is separate from the Docker mutation protocol. */
import {
  lstatSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  openSync,
  fstatSync,
  closeSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { join, isAbsolute } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { required } from "./npm-update-contract.mjs";
import { readBytes } from "./npm-update-process-core.mjs";
import { canonicalJson } from "./automation-provenance-contract.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");

/** Aliases, public storage and mount syntax cannot become allocation authority. */
export function assertMysqlRoot(root) {
  const st = lstatSync(root);
  required(
    isAbsolute(root) &&
      realpathSync(root) === root &&
      !/[\n\r,]/.test(root) &&
      st.isDirectory() &&
      !st.isSymbolicLink() &&
      st.uid === process.getuid() &&
      (st.mode & 0o077) === 0,
    "MySQL root is aliased or not private owned storage"
  );
  return { dev: st.dev, ino: st.ino };
}

/** Credentials never enter argv, Docker environment values or exported diagnostics. */
function privateFiles(directory, user, password, created) {
  const rootPassword = randomBytes(32).toString("hex");
  const values = {
    "root-password": rootPassword,
    "admin.cnf": `[client]\nuser=root\npassword=${rootPassword}\nhost=127.0.0.1\nprotocol=TCP\nget-server-public-key=1\n`,
    "app.cnf": `[client]\nuser=${user}\npassword=${password}\nhost=127.0.0.1\nprotocol=TCP\nget-server-public-key=1\n`,
  };
  return Object.entries(values).map(([name, value]) => {
    const file = join(directory, name);
    return { name, ...privateWrite(file, value, created) };
  });
}

/** Exclusive descriptor ownership is recorded before a write can fail partially. */
function privateWrite(file, value, created) {
  const fd = openSync(file, "wx", 0o600);
  try {
    const st = fstatSync(fd);
    const owned = { file, dev: st.dev, ino: st.ino };
    created.push(owned);
    writeFileSync(fd, value);
    return { ...owned, sha256: digest(Buffer.from(value)) };
  } finally {
    closeSync(fd);
  }
}

/** Only exclusively created private inodes can be removed after construction failure. */
function removeConstruction(root, rootId, directory, dirId, created) {
  const nowRoot = assertMysqlRoot(root);
  const nowDir = assertMysqlRoot(directory);
  const inDirectory = created.filter(file =>
    file.file.startsWith(`${directory}/`)
  );
  required(
    nowRoot.dev === rootId.dev &&
      nowRoot.ino === rootId.ino &&
      nowDir.dev === dirId.dev &&
      nowDir.ino === dirId.ino &&
      readdirSync(directory).sort().join(",") ===
        inDirectory
          .map(file => file.file.slice(directory.length + 1))
          .sort()
          .join(","),
    "MySQL partial storage ownership changed"
  );
  for (const file of created) {
    const st = lstatSync(file.file);
    required(
      st.isFile() &&
        !st.isSymbolicLink() &&
        st.nlink === 1 &&
        st.uid === process.getuid() &&
        (st.mode & 0o077) === 0 &&
        st.dev === file.dev &&
        st.ino === file.ino,
      "MySQL partial file ownership changed"
    );
  }
  for (const file of inDirectory) unlinkSync(file.file);
  rmdirSync(directory);
  for (const file of created.filter(file => !inDirectory.includes(file)))
    unlinkSync(file.file);
}

/** Re-read immutable private bytes and directory census before every daemon operation. */
function validateStorage(storage) {
  const {
    root,
    directory,
    rootId,
    dirId,
    registration,
    registrationBytes,
    files,
  } = storage;
  const nowRoot = assertMysqlRoot(root);
  const nowDir = assertMysqlRoot(directory);
  required(
    nowRoot.dev === rootId.dev &&
      nowRoot.ino === rootId.ino &&
      nowDir.dev === dirId.dev &&
      nowDir.ino === dirId.ino &&
      readBytes(registration).equals(registrationBytes),
    "MySQL private ownership changed"
  );
  required(
    readdirSync(directory).sort().join(",") ===
      files
        .map(file => file.name)
        .sort()
        .join(","),
    "MySQL private ownership contains foreign data"
  );
  for (const file of files) {
    const st = lstatSync(file.file);
    required(
      st.dev === file.dev &&
        st.ino === file.ino &&
        digest(readBytes(file.file)) === file.sha256,
      "MySQL private file ownership changed"
    );
  }
}

/** A fixed registration prevents the enclosing updater from deleting outstanding resource authority. */
export function createMysqlStorage(root, identity, user, password) {
  const rootId = assertMysqlRoot(root);
  const directory = join(root, `rails-mysql-${identity.nonce}`);
  mkdirSync(directory, { mode: 0o700 });
  const dirId = assertMysqlRoot(directory);
  const created = [];
  let files;
  const registration = join(
    root,
    `namespace-${identity.nonce.slice(0, 16)}.json`
  );
  try {
    privateWrite(
      registration,
      `${canonicalJson({ version: 1, kind: "rails-mysql", ...identity, directory })}\n`,
      created
    );
    files = privateFiles(directory, user, password, created);
  } catch (error) {
    try {
      removeConstruction(root, rootId, directory, dirId, created);
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "MySQL partial storage cleanup refused",
        { cause: error }
      );
    }
    throw error;
  }
  const storage = {
    root,
    rootId,
    directory,
    dirId,
    files,
    registration,
    registrationBytes: readBytes(registration),
  };
  return {
    files,
    validate: () => validateStorage(storage),
    remove() {
      validateStorage(storage);
      for (const file of files) unlinkSync(file.file);
      rmdirSync(directory);
      required(
        !readdirSync(root).includes(directory.slice(root.length + 1)),
        "MySQL private directory remains"
      );
      unlinkSync(registration);
    },
  };
}
