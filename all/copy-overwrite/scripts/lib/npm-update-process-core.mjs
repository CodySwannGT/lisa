// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-process-core.mjs
 * @description Private bounded process and file boundaries keep credentials out of candidates.
 * @module npm-updater
 */
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  ftruncateSync,
  readSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  lstatSync,
  existsSync,
  realpathSync,
  readdirSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { required } from "./npm-update-contract.mjs";

/** A fresh HOME and allowlist remove ambient Git/npm/issuer/write authority. */
export function candidateEnvironment(home, source = process.env) {
  return {
    PATH: source.PATH ?? "/usr/bin:/bin",
    HOME: home,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "UTC",
    TMPDIR: join(home, "tmp"),
    NPM_CONFIG_USERCONFIG: join(home, "npmrc"),
    NPM_CONFIG_GLOBALCONFIG: join(home, "global-npmrc"),
    NPM_CONFIG_CACHE: join(home, "npm-cache"),
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    GIT_TERMINAL_PROMPT: "0",
  };
}

/**
 * Single owned root includes every cache and temp path; cleanup is a checked result.
 * @template T
 * @param {(root: string, env: NodeJS.ProcessEnv) => T | Promise<T>} operation Owned work.
 * @returns {Promise<T>} The operation result after checked cleanup.
 */
export async function withPrivateRoot(operation) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lisa-npm-update-")));
  const nonce = randomBytes(24).toString("hex");
  writeFileSync(join(root, "owner"), nonce, { mode: 0o600 });
  mkdirSync(join(root, "tmp"), { mode: 0o700 });
  try {
    return await operation(root, candidateEnvironment(root));
  } finally {
    required(
      lstatSync(root).isDirectory() &&
        !lstatSync(root).isSymbolicLink() &&
        readFileSync(join(root, "owner"), "utf8") === nonce,
      "cleanup ownership changed"
    );
    required(
      !readdirSync(root).some(name =>
        /^namespace-[a-f0-9]{16}\.json$/.test(name)
      ),
      "owned namespace registration cleanup outstanding"
    );
    rmSync(root, { recursive: true });
    required(!existsSync(root), "owned root cleanup failed");
  }
}

/** Read through a no-follow descriptor so aliases and growth cannot bypass bounds. */
export function readBytes(file, maximum = 3_145_728, privateFile = true) {
  required(
    Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 4_194_304,
    "invalid file bound"
  );
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    required(
      st.isFile() &&
        st.size <= maximum &&
        (!privateFile ||
          ((st.mode & 0o077) === 0 &&
            st.nlink === 1 &&
            st.uid === process.getuid())),
      "invalid bounded private file"
    );
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    let count;
    do {
      count = readSync(fd, bytes, length, bytes.length - length, null);
      length += count;
      required(length <= maximum, "file grew beyond bound");
    } while (count > 0);
    return bytes.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}

/** Canonical serialization rejects duplicate keys instead of discarding ambiguity. */
export function readJson(file, maximum) {
  const bytes = readBytes(file, maximum);
  const text = new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(
    bytes
  );
  const value = JSON.parse(text);
  required(
    text === `${canonicalJson(value)}\n`,
    "JSON must be canonical without duplicate fields"
  );
  return value;
}

/** Fresh outputs never follow symlinks or overwrite recovery evidence. */
export function writeJson(file, value) {
  const absolute = resolve(file);
  writeFileSync(absolute, `${canonicalJson(value)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  return absolute;
}

/** Replace only an already private, singly linked owned phase file. */
export function replaceJson(file, value) {
  const bytes = Buffer.from(`${canonicalJson(value)}\n`);
  required(bytes.length <= 3_145_728, "replacement phase data exceeds bound");
  const fd = openSync(file, constants.O_WRONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    required(
      stat.isFile() &&
        stat.nlink === 1 &&
        stat.uid === process.getuid() &&
        (stat.mode & 0o077) === 0,
      "phase replacement is not owned private data"
    );
    ftruncateSync(fd, 0);
    writeFileSync(fd, bytes);
  } finally {
    closeSync(fd);
  }
  required(readBytes(file).equals(bytes), "phase replacement readback differs");
}

/** A fixed phase directory must be private and genuinely owned before any writes. */
export function phaseDirectory(directory) {
  const parent = lstatSync(dirname(directory));
  required(
    parent.isDirectory() && !parent.isSymbolicLink(),
    "phase parent is aliased"
  );
  if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
  const stat = lstatSync(directory);
  required(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      stat.uid === process.getuid() &&
      (stat.mode & 0o077) === 0,
    "phase directory is not owned private storage"
  );
}

export { runProcess } from "./npm-update-native-process.mjs";
