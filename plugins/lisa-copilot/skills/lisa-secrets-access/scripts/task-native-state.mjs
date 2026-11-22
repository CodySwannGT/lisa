/** Ephemeral session gate state: hashes only, private files, exclusive atomic consumption. */
import { randomBytes } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { gateDirectory, sessionEpoch } from "./task-native-lifecycle.mjs";
import { AccessFailure } from "./config-layers.mjs";
import { fingerprint } from "./task-native-contract.mjs";
const fail = () => {
  throw new AccessFailure("native-response-unrepresented");
};
const hex = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const generation = () => randomBytes(32).toString("hex");

/**
 * Cooperate only with a live exclusive owner, within the existing 120s hook bound.
 * @param {string} lock
 * @returns {number} Exclusive file descriptor.
 */
function acquire(lock) {
  const deadline = performance.now() + 1000;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      return openSync(lock, "wx", 0o600);
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "EEXIST" ||
        performance.now() >= deadline
      )
        fail();
      Atomics.wait(pause, 0, 0, Math.min(10, deadline - performance.now()));
    }
  }
}

/** Scope names are never used as filenames. */
export function sessionKey(event, root) {
  if (
    typeof event.session_id !== "string" ||
    !event.session_id ||
    event.session_id.length > 512
  )
    fail();
  return fingerprint({
    epoch: sessionEpoch(event, root),
    agent: event.agent_id ?? null,
  });
}

/** Refuse malformed/tampered state rather than treating it as a prior successful check. */
function validate(value, key) {
  const fields = [
    "schema",
    "session",
    "scope",
    "action",
    "generation",
    "phase",
    "pending",
    "flight",
    "spent",
    "failure",
  ];
  if (
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some(k => !fields.includes(k)) ||
    ![null, "identity-mismatch", "native-response-unrepresented"].includes(
      value.failure
    ) ||
    value.schema !== 1 ||
    value.session !== key ||
    !hex(value.scope) ||
    !hex(value.action) ||
    !hex(value.generation) ||
    !["pending", "ready", "consumed"].includes(value.phase) ||
    !Array.isArray(value.pending) ||
    !Array.isArray(value.spent) ||
    !value.spent.every(hex)
  )
    fail();
  for (const row of value.pending)
    if (
      Object.keys(row).sort().join() !== "connection,index,scope,step" ||
      !Number.isInteger(row.index) ||
      row.index < 1 ||
      row.index > 100 ||
      !hex(row.scope) ||
      ![0, 1, 2].includes(row.step) ||
      !(row.connection === null || hex(row.connection))
    )
      fail();
  if (
    value.flight &&
    (Object.keys(value.flight).sort().join() !==
      "call,connection,index,input,kind" ||
      !hex(value.flight.call) ||
      !hex(value.flight.input) ||
      !hex(value.flight.connection) ||
      !["self", "fetch"].includes(value.flight.kind))
  )
    fail();
  if (
    ["ready", "consumed"].includes(value.phase) &&
    (value.flight !== null || !value.pending.every(row => row.step === 2))
  )
    fail();
  return value;
}

/** The callback completes while a per-entry lock is held; allow follows its atomic write. */
export function withNativeState(key, callback) {
  const directory = gateDirectory();
  const dir = lstatSync(directory);
  if (
    !dir.isDirectory() ||
    dir.isSymbolicLink() ||
    dir.mode & 0o022 ||
    (process.getuid && dir.uid !== process.getuid())
  )
    fail();
  const path = join(directory, `readiness-${key}.json`),
    lock = `${path}.lock`;
  const fd = acquire(lock);
  try {
    let value = null;
    try {
      const stat = lstatSync(path);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.mode & 0o077 ||
        (process.getuid && stat.uid !== process.getuid())
      )
        fail();
      value = validate(JSON.parse(readFileSync(path, "utf8")), key);
    } catch (error) {
      if (error.code !== "ENOENT") fail();
    }
    const result = callback(value);
    if (result.state === null) rmSync(path, { force: true });
    else {
      validate(result.state, key);
      const temporary = `${path}.${generation()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify(result.state), {
          flag: "wx",
          mode: 0o600,
        });
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
    }
    return result.result;
  } finally {
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}
