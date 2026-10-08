/** Only bounded native metadata leaves this source-owned component qualifier. */
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { required } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { runProcess } from "../../../all/copy-overwrite/scripts/lib/npm-update-process-core.mjs";
import { runtimeTime } from "../../../all/copy-overwrite/scripts/lib/npm-update-rails-tool-identity.mjs";
import { join } from "node:path";

const STAGES = new Set([
  "source",
  "fixture-lock",
  "fixture-install",
  "fixture-git",
  "fixture-manager",
  "original-commit",
  "original-push",
  "browser",
  "daemon-before",
  "daemon-after",
]);
const CLASSES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "AggregateError",
  "UpdaterError",
]);

/**
 * Hashes describe captured bytes without exporting command content or credentials.
 * @param {string | Buffer} value Observed bounded bytes.
 * @returns {string} Observed hexadecimal SHA256 digest.
 */
export function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * A finite class chain retains both operation and cleanup errors without messages or arbitrary properties.
 * @param {Error | undefined} error Observed native error or undefined.
 * @returns {Array<object>} Closed bounded error observations.
 */
export function failureMetadata(error) {
  const result = [];
  const seen = new Set();
  const pending = [error];
  while (pending.length && result.length < 4) {
    const current = pending.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (current.cause) pending.push(current.cause);
    if (current instanceof AggregateError)
      pending.push(...current.errors.slice(0, 4));
    result.push({
      class: CLASSES.has(current.name) ? current.name : "OtherError",
      messageSha256: digest(String(current.message ?? "").slice(0, 65536)),
    });
  }
  return result;
}

/**
 * Exclusive descriptor publication cannot redirect output after the parent's pathname changes.
 * @param {string} file Fresh explicit private output.
 * @returns {{write: (value: object) => void, close: () => void}} Checked component evidence.
 */
export function privateResult(file) {
  const parent = dirname(file);
  const before = lstatSync(parent);
  if (
    !(
      before.isDirectory() &&
      !before.isSymbolicLink() &&
      before.uid === process.getuid() &&
      (before.mode & 0o777) === 0o700 &&
      realpathSync(parent) === parent
    )
  )
    required(false, "qualification parent is not private");
  const fd = openSync(
    file,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600
  );
  const original = fstatSync(fd);
  return {
    write(value) {
      const directory = lstatSync(parent);
      const actual = fstatSync(fd);
      const path = lstatSync(file);
      required(
        directory.dev === before.dev &&
          directory.ino === before.ino &&
          !directory.isSymbolicLink() &&
          realpathSync(parent) === parent,
        "qualification parent changed"
      );
      required(
        actual.isFile() &&
          actual.nlink === 1 &&
          actual.uid === process.getuid() &&
          (actual.mode & 0o777) === 0o600 &&
          actual.dev === original.dev &&
          actual.ino === original.ino &&
          path.dev === actual.dev &&
          path.ino === actual.ino &&
          !path.isSymbolicLink(),
        "qualification output changed"
      );
      const bytes = `${JSON.stringify(value)}\n`;
      required(
        Buffer.byteLength(bytes) <= 65536,
        "qualification summary is unbounded"
      );
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    },
    close() {
      closeSync(fd);
    },
  };
}

/**
 * The existing native supervisor retains real status and privately bounded streams even on refusal.
 * @param {string} captures Owned private capture directory.
 * @param {number} deadline Original absolute expiry.
 * @param {Array<object>} records Metadata-only event collection.
 * @returns {function(string, string, object, string, Array<string>): Promise<object>} Original supervised command recorder.
 */
export function nativeRecorder(captures, deadline, records) {
  return async (stage, cwd, env, command, args) => {
    required(STAGES.has(stage), "unknown qualification stage");
    const started = performance.now();
    const state = {};
    try {
      state.result = await runProcess(command, args, {
        cwd,
        env,
        timeout: runtimeTime(deadline, stage === "browser" ? 10000 : 1800000),
        maximum: 3145728,
      });
    } catch (error) {
      state.result = error;
      state.failure = error;
    }
    const sequence = records.length;
    const streams = Object.fromEntries(
      ["stdout", "stderr"].map(name => [
        name,
        Buffer.isBuffer(state.result?.[name])
          ? state.result[name]
          : Buffer.alloc(0),
      ])
    );
    const facts = Object.fromEntries(
      Object.entries(streams).flatMap(([name, bytes]) => [
        [`${name}Bytes`, bytes.length],
        [`${name}Sha256`, digest(bytes)],
      ])
    );
    const record = {
      stage,
      status: Number.isInteger(state.result?.code) ? state.result.code : null,
      elapsedMs: Math.round(performance.now() - started),
      ...facts,
      failure: failureMetadata(state.failure),
    };
    records.push(record);
    try {
      for (const [name, bytes] of Object.entries(streams))
        writeFileSync(join(captures, `capture-${sequence}-${name}`), bytes, {
          flag: "wx",
          mode: 0o600,
        });
    } catch (error) {
      record.captureFailure = failureMetadata(error);
      if (state.failure)
        throw new AggregateError(
          [state.failure, error],
          "native qualification and private capture failed",
          { cause: state.failure }
        );
      throw error;
    }
    if (state.failure) throw state.failure;
    return state.result;
  };
}

/**
 * Genuine hook rows must cover every physical role and demonstrate administrator access refusal.
 * @param {Array<object>} rows Actual four-role hook readback.
 * @returns {boolean} True only after all required actual witnesses.
 */
export function hookWitness(rows) {
  const expected = ["test", "queue_test", "cache_test", "cable_test"];
  required(Array.isArray(rows) && rows.length === 4, "four hook roles missing");
  for (const [index, value] of rows.entries())
    required(
      value &&
        Object.keys(value).sort().join(",") ===
          "administrator_read_denied,native_rows,physical_schema,role" &&
        value.role === expected[index] &&
        value.physical_schema === true &&
        value.native_rows === 1 &&
        value.administrator_read_denied === true,
      "native hook witness differs"
    );
  return true;
}
