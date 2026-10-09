/** Fixture-only capture interpretation; emitted headers are observations, not proven exception identities. */
import {
  mysqlErrorData,
  mysqlObservation,
} from "../../all/copy-overwrite/scripts/lib/npm-update-rails-mysql-daemon.mjs";

const HEADERS = [
  "LoadError",
  "NameError",
  "NoMethodError",
  "ArgumentError",
  "TypeError",
  "Gem::LoadError",
  "Bundler::GemNotFound",
  "Zeitwerk::NameError",
  "Mysql2::Error",
  "ActiveRecord::ConnectionNotEstablished",
  "ActiveRecord::NoDatabaseError",
  "ActiveRecord::StatementInvalid",
  "ActiveRecord::PendingMigrationError",
].map(name => ({ name, prefix: Buffer.from(`${name}:`) }));
const ASSERTIONS = Object.freeze({
  "MySQL container absence is unproved": "container-absence-unproved",
  "original runtime deadline is absent or expired": "runtime-deadline-expired",
  "MySQL private ownership changed": "private-ownership-changed",
  "MySQL container ownership differs": "container-ownership-changed",
  "MySQL container mount ownership differs":
    "container-mount-ownership-changed",
  "MySQL private loopback port differs": "private-port-changed",
});

/**
 * Follow only own data descriptors; getters and unbounded/cyclic causes do not run.
 * @param {unknown} error - Original failure.
 * @returns {unknown[]} Bounded cause observations.
 */
function causeChain(error) {
  const result = [];
  const cursor = { error };
  while (cursor.error && result.length < 8 && !result.includes(cursor.error)) {
    result.push(cursor.error);
    cursor.error = mysqlErrorData(cursor.error, "cause");
  }
  return result;
}

/**
 * Select only a closed assertion identifier.
 * @param {unknown} message - Candidate failure text retained in memory.
 * @returns {string|null} Known assertion identifier.
 */
function fixedAssertion(message) {
  if (typeof message !== "string") return null;
  const reason = message.startsWith("npm updater: ")
    ? message.slice(13)
    : message;
  return Object.hasOwn(ASSERTIONS, reason) ? ASSERTIONS[reason] : null;
}

/**
 * A constant-memory line cursor exports only fixed synthetic-fixture paths and bounded line integers.
 * @param {unknown} bytes - Native capture retained in memory.
 * @returns {{emittedRailsHeaders:string[], emittedFixtureFrames:Array<{file:string,line:number}>}} Closed emitted header and fixture frame observations.
 */
function captureHeaders(bytes) {
  const headers = new Set();
  const frames = new Map();
  const cursor = { offset: 0 };
  if (!Buffer.isBuffer(bytes) || bytes.length > 3145728)
    return { emittedRailsHeaders: [], emittedFixtureFrames: [] };
  while (cursor.offset < bytes.length) {
    const newline = bytes.indexOf(10, cursor.offset);
    const end = newline < 0 ? bytes.length : newline;
    const line = bytes.subarray(cursor.offset, end);
    for (const { name, prefix } of HEADERS)
      if (line.subarray(0, prefix.length).equals(prefix)) headers.add(name);
    if (line.length <= 4096 && frames.size < 8) {
      const frame =
        /^\s*\/proof\/case\/(config\/(?:application|environment|boot)\.rb|bin\/rails|Rakefile|db\/(?:primary|queue|cache|cable)_migrate\/20261008000000_create_runtime_witnesses\.rb):([1-9]\d{0,5})(?=:|\s|$)/.exec(
          line.toString("utf8")
        );
      if (frame)
        frames.set(`${frame[1]}:${frame[2]}`, {
          file: frame[1],
          line: Number(frame[2]),
        });
    }
    cursor.offset = end + 1;
  }
  return {
    emittedRailsHeaders: [...headers],
    emittedFixtureFrames: [...frames.values()],
  };
}

/**
 * Never emit messages, raw capture, argv, environment, SQL, or a recursive original cause.
 * @param {unknown} error - Original failure retained in memory.
 * @returns {ReturnType<typeof mysqlObservation> & {emittedRailsHeaders:string[], emittedFixtureFrames:Array<{file:string,line:number}>, fixedSourceAssertion:string|null}} Bounded nonsecret metadata.
 */
export function observeMysqlFailure(error) {
  const chain = causeChain(error);
  const captured =
    chain.find(
      value =>
        Buffer.isBuffer(mysqlErrorData(value, "stdout")) ||
        Buffer.isBuffer(mysqlErrorData(value, "stderr"))
    ) ?? error;
  const observation = chain
    .map(value => mysqlErrorData(value, "observation"))
    .find(value => mysqlErrorData(value, "phase"));
  const metadata = mysqlObservation(
    captured,
    mysqlErrorData(observation, "phase") ?? "command"
  );
  const assertion =
    chain
      .map(value => mysqlErrorData(value, "message"))
      .map(fixedAssertion)
      .find(Boolean) ?? null;
  return {
    ...metadata,
    ...captureHeaders(mysqlErrorData(captured, "stderr")),
    fixedSourceAssertion: assertion,
  };
}
