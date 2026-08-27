/** Bounded, exact IPC envelopes shared by the test-run protocol processes. */
import * as path from "node:path";

import { validateScratchRunRootIntent } from "./scratch-supervision-intent.js";

/** Maximum serialized IPC envelope accepted by a protocol process. */
const MAX_PROTOCOL_BYTES = 128 * 1_024;

/** Empty message types whose exact schema has no payload fields. */
const EMPTY_TYPES: ReadonlySet<string> = new Set([
  "REAPER_READY",
  "COMMAND_READY",
  "GO",
  "STOP",
  "CLEANED",
  "DISARMED",
]);

/** Correlated acknowledgement types carrying only the intent token. */
const CORRELATED_TYPES: ReadonlySet<string> = new Set([
  "ROOT_INTENT_ARMED",
  "TARGET_ARMED",
  "MATERIALIZE_ROOT",
]);

/** Closed protocol message vocabulary. */
const PROTOCOL_TYPES: ReadonlySet<string> = new Set([
  ...EMPTY_TYPES,
  ...CORRELATED_TYPES,
  "ROOT_INTENT",
  "ROOT_ARMED",
  "BOOTSTRAP_READY",
  "COMMAND",
  "TARGET_INTENT",
  "SIGNAL",
  "PAYLOAD_EXIT",
  "PAYLOAD_ERROR",
]);

/** Catchable signals accepted by the forwarding protocol. */
const PROTOCOL_SIGNALS: ReadonlySet<string> = new Set([
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
]);

/** Versioned IPC envelope after bounded structural validation. */
export interface ScratchProtocolMessageV1 extends Record<string, unknown> {
  readonly schema: 1;
  readonly type: string;
}

/**
 * Whether an object has exactly the declared own string keys.
 * @param value - Candidate object
 * @param keys - Required exact keys
 * @returns Whether the keys match exactly
 */
function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort((left, right) =>
    left.localeCompare(right)
  );
  const expected = [...keys].sort((left, right) => left.localeCompare(right));
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

/**
 * Whether a correlation is one exact root-intent token.
 * @param value - Candidate correlation
 * @returns Whether it is one exact token
 */
function validCorrelation(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/u.test(value);
}

/**
 * Whether a bootstrap command is exact, bounded, and inert.
 * @param value - Candidate command
 * @returns Whether the command contract is valid
 */
function validBootstrapCommand(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const command = value as Record<string, unknown>;
  const argv = command["argv"];
  const commandEnv = command["env"];
  return (
    hasExactKeys(command, ["schema", "argv", "env"]) &&
    command["schema"] === 1 &&
    Array.isArray(argv) &&
    argv.length > 0 &&
    argv.length <= 4_096 &&
    argv.every(
      argument =>
        typeof argument === "string" &&
        Buffer.byteLength(argument, "utf8") <= 16 * 1_024
    ) &&
    typeof commandEnv === "object" &&
    commandEnv !== null &&
    Object.keys(commandEnv).length <= 4_096 &&
    Object.entries(commandEnv).every(
      ([key, entry]) =>
        key !== "" &&
        Buffer.byteLength(key, "utf8") <= 1_024 &&
        typeof entry === "string" &&
        Buffer.byteLength(entry, "utf8") <= 64 * 1_024
    )
  );
}

/**
 * Whether a target is one exact, birth-bound process-group leader.
 * @param value - Candidate target
 * @returns Whether the target contract is valid
 */
function validTargetIntent(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  return (
    hasExactKeys(target, ["pid", "pgid", "processBirthFingerprint"]) &&
    Number.isSafeInteger(target["pid"]) &&
    (target["pid"] as number) > 0 &&
    target["pgid"] === target["pid"] &&
    typeof target["processBirthFingerprint"] === "string" &&
    target["processBirthFingerprint"] !== "" &&
    Buffer.byteLength(target["processBirthFingerprint"], "utf8") <= 256
  );
}

/**
 * Whether a root identity carries only exact canonical inode authority.
 * @param value - Candidate root identity
 * @returns Whether the value is exact and bounded
 */
function validRootIdentity(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const root = value as Record<string, unknown>;
  return (
    hasExactKeys(root, ["canonicalPath", "dev", "ino"]) &&
    typeof root["canonicalPath"] === "string" &&
    path.isAbsolute(root["canonicalPath"]) &&
    Buffer.byteLength(root["canonicalPath"], "utf8") <= 4_096 &&
    Number.isSafeInteger(root["dev"]) &&
    Number.isSafeInteger(root["ino"])
  );
}

/**
 * Exact-key helper specialized to one protocol message.
 * @param message - Candidate message
 * @param keys - Message-specific keys
 * @returns Whether the complete key set matches
 */
function exactMessageKeys(
  message: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): boolean {
  return hasExactKeys(message, ["schema", "type", ...keys]);
}

/**
 * Validate one correlated ROOT_INTENT message.
 * @param message - Candidate message
 * @returns Whether the root intent is exact
 */
function validRootIntentMessage(
  message: Readonly<Record<string, unknown>>
): boolean {
  return (
    exactMessageKeys(message, ["correlation", "intent"]) &&
    validCorrelation(message["correlation"]) &&
    validateScratchRunRootIntent(message["intent"]).token ===
      message["correlation"]
  );
}

/**
 * Validate one birth-bound TARGET_INTENT message.
 * @param message - Candidate message
 * @returns Whether the target intent is exact
 */
function validTargetIntentMessage(
  message: Readonly<Record<string, unknown>>
): boolean {
  return (
    exactMessageKeys(message, ["correlation", "target"]) &&
    validCorrelation(message["correlation"]) &&
    validTargetIntent(message["target"])
  );
}

/**
 * Validate one terminal payload result.
 * @param message - Candidate message
 * @returns Whether the result is exact
 */
function validPayloadExitMessage(
  message: Readonly<Record<string, unknown>>
): boolean {
  return (
    exactMessageKeys(message, ["code", "signal"]) &&
    (message["code"] === null || Number.isInteger(message["code"])) &&
    (message["signal"] === null ||
      (typeof message["signal"] === "string" &&
        /^SIG[A-Z0-9]+$/u.test(message["signal"])))
  );
}

/** Message-specific validators outside the empty/correlation families. */
const BODY_VALIDATORS: Readonly<
  Record<string, (message: Readonly<Record<string, unknown>>) => boolean>
> = {
  BOOTSTRAP_READY: message =>
    exactMessageKeys(message, ["pid"]) &&
    Number.isSafeInteger(message["pid"]) &&
    (message["pid"] as number) > 0,
  ROOT_INTENT: validRootIntentMessage,
  TARGET_INTENT: validTargetIntentMessage,
  ROOT_ARMED: message =>
    exactMessageKeys(message, ["correlation", "root"]) &&
    validCorrelation(message["correlation"]) &&
    validRootIdentity(message["root"]),
  COMMAND: message =>
    exactMessageKeys(message, ["command"]) &&
    validBootstrapCommand(message["command"]),
  SIGNAL: message =>
    exactMessageKeys(message, ["signal"]) &&
    typeof message["signal"] === "string" &&
    PROTOCOL_SIGNALS.has(message["signal"]),
  PAYLOAD_ERROR: message =>
    exactMessageKeys(message, ["message"]) &&
    typeof message["message"] === "string" &&
    message["message"] !== "" &&
    Buffer.byteLength(message["message"], "utf8") <= 4_096,
  PAYLOAD_EXIT: validPayloadExitMessage,
};

/**
 * Whether one exact message-specific body matches its declared type.
 * @param message - Candidate message
 * @param type - Declared protocol type
 * @returns Whether the message-specific shape is exact
 */
function validMessageBody(
  message: Readonly<Record<string, unknown>>,
  type: string
): boolean {
  if (EMPTY_TYPES.has(type)) return exactMessageKeys(message, []);
  if (CORRELATED_TYPES.has(type)) {
    return (
      exactMessageKeys(message, ["correlation"]) &&
      validCorrelation(message["correlation"])
    );
  }
  return BODY_VALIDATORS[type]?.(message) ?? false;
}

/**
 * Validate a bounded version-one IPC message against the closed vocabulary.
 * @param value - Candidate message
 * @returns Validated message envelope
 */
export function parseScratchProtocolMessage(
  value: unknown
): ScratchProtocolMessageV1 {
  const serialized = (() => {
    try {
      return JSON.stringify(value);
    } catch {
      throw new Error("Scratch protocol message must be serializable");
    }
  })();
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, "utf8") > MAX_PROTOCOL_BYTES
  ) {
    throw new Error("Scratch protocol message exceeds its byte bound");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Scratch protocol message must be an object");
  }
  const message = value as Record<string, unknown>;
  const type = message["type"];
  if (
    message["schema"] !== 1 ||
    typeof type !== "string" ||
    !PROTOCOL_TYPES.has(type)
  ) {
    throw new Error("Invalid scratch protocol message schema");
  }
  if (!validMessageBody(message, type)) {
    throw new Error(`Invalid ${type} scratch protocol message`);
  }
  return value as ScratchProtocolMessageV1;
}
