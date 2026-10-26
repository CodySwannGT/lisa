/** Package diagnostics expose a finite route and validated versions while retaining original native output privately. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { required } from "../../../all/copy-overwrite/scripts/lib/npm-update-contract.mjs";
import { publicFailure } from "../../../all/copy-overwrite/scripts/lib/npm-update-invariants.mjs";
import { digest, failureMetadata } from "./observations.mjs";

/**
 * The authenticated installer owns execution; capture its original refusal without a replacement callback.
 * @param {string} captures Owned private capture directory.
 * @param {Array<object>} records Existing bounded native observations.
 * @param {string} stage Source-observed package phase.
 * @param {Error} error Original native exception, retaining its captured streams.
 * @returns {void}
 */
export function recordPackageFailure(captures, records, stage, error) {
  if (!["apt-update", "apt-install"].includes(stage))
    required(false, "unknown package failure phase");
  const sequence = records.length;
  const streams = Object.fromEntries(
    ["stdout", "stderr"].map(name => [
      name,
      Buffer.isBuffer(error?.[name]) ? error[name] : Buffer.alloc(0),
    ])
  );
  const record = {
    stage,
    status: Number.isInteger(error?.code) ? error.code : null,
    // The installer did not publish a start clock. Do not invent a duration.
    elapsedMs: null,
    nativeFailure: publicFailure(error),
    ...Object.fromEntries(
      Object.entries(streams).flatMap(([name, bytes]) => [
        [`${name}Bytes`, bytes.length],
        [`${name}Sha256`, digest(bytes)],
      ])
    ),
    failure: failureMetadata(error),
  };
  records.push(record);
  try {
    for (const [name, bytes] of Object.entries(streams))
      writeFileSync(join(captures, `capture-${sequence}-${name}`), bytes, {
        flag: "wx",
        mode: 0o600,
      });
  } catch (failure) {
    record.captureFailure = failureMetadata(failure);
    throw failure;
  }
}

/**
 * Only fixed package names and bounded Debian-version fields are published.
 * @param {string} name Source-owned package name.
 * @param {object} result Native dpkg-query result or original failure.
 * @returns {object} Closed presence/read status and a validated observed version.
 */
export function packageVersionObservation(name, result) {
  if (!["libx11-6", "libx11-xcb1"].includes(name))
    required(false, "unknown pre-state package");
  const bytes = Buffer.isBuffer(result?.stdout)
    ? result.stdout
    : Buffer.alloc(0);
  if (
    result?.code === 1 &&
    result.nativeCompleted === true &&
    bytes.length === 0
  )
    return { name, status: "absent" };
  const match =
    bytes.length <= 256 &&
    new RegExp(
      `^${name}(?::amd64)?\\t([0-9][A-Za-z0-9.+:~\\-]{0,127})\\n$`
    ).exec(bytes.toString("utf8"));
  return result?.code === 0 && match
    ? { name, status: "installed", version: match[1] }
    : { name, status: "unavailable" };
}

/**
 * A failed optional version read is recorded as unavailable and cannot authorize package installation.
 * @param {function(string, string, object, string, Array<string>): Promise<object>} native Original native recorder.
 * @param {string} source Explicit source cwd.
 * @param {object} env Closed original environment.
 * @returns {Promise<Array<object>>} Fixed-name package presence observations.
 */
export async function observePackagePrestate(native, source, env) {
  const result = [];
  for (const name of ["libx11-6", "libx11-xcb1"]) {
    const observed = await native(
      "package-prestate",
      source,
      env,
      "/usr/bin/dpkg-query",
      ["-W", "-f=${binary:Package}\t${Version}\n", "--", name]
    ).catch(error => error);
    result.push(packageVersionObservation(name, observed));
  }
  return result;
}
