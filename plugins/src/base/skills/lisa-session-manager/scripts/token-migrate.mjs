/**
 * Migrating the old plaintext Telegram bot token file into the secrets
 * provider (#4555): reading `<notify.stateDir>/.env`, deciding whether it
 * may be deleted, and the refusals `store-token` and `start` share.
 *
 * Split from token-store.mjs, which keeps the provider calls. The two sides
 * of the migration must agree on what counts as a leftover token, or an
 * operator is sent round a loop: `start` refuses only a file that really
 * holds a `TELEGRAM_BOT_TOKEN` line ({@link holdsToken}), and `store-token`
 * deletes a file with no token and nothing else in it (empty, or comments
 * only) once the provider holds a verified secret ({@link removable}).
 *
 * Values are never kept beyond the comparison, returned in a message or
 * logged; a file's other keys are reported by name only.
 * @module session-manager/token-migrate
 */
import { createHash } from "node:crypto";
import path from "node:path";

import { validateBotToken } from "./token.mjs";

/** The plugin's plaintext token file in the state dir (the old storage). */
export const TOKEN_FILE = ".env";

/** The variable the Telegram plugin reads its token from. */
export const TOKEN_VAR = "TELEGRAM_BOT_TOKEN";

/** One `KEY=value` line of a dotenv file, optionally `export`ed. */
const ENV_LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** A refusal or failure carrying the exit code the CLI should use. */
export class TokenStoreError extends Error {
  /**
   * @param {string} message - Operator-readable reason; never a value
   * @param {number} exitCode - 1 (failure, retry) or 2 (setup)
   */
  constructor(message, exitCode) {
    super(message);
    this.name = "TokenStoreError";
    this.exitCode = exitCode;
  }
}

/**
 * Exit 2: something the operator has to change.
 * @param {string} message - Reason
 * @returns {TokenStoreError} Error
 */
export const setupError = message => new TokenStoreError(message, 2);

/**
 * sha256 of a value, for comparing a written secret with its read-back.
 * @param {string} value - Value
 * @returns {string} Hex digest
 */
export function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

/**
 * Read the plaintext token file, if there is one: its token, and the names
 * of anything else in it (values are never kept or reported).
 * @param {string} stateDir - Resolved state dir
 * @param {Pick<import("node:fs"), "existsSync" | "readFileSync">} fs - Seam
 * @returns {{ path: string, token: string | undefined, others: string[] } |
 *   null} The file, or null when absent
 */
export function readEnvFile(stateDir, fs) {
  const file = path.join(stateDir, TOKEN_FILE);
  if (!fs.existsSync(file)) return null;
  const entries = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line, at) => ({ line: line.trim(), at }))
    .filter(({ line }) => line !== "" && !line.startsWith("#"))
    .map(({ line, at }) => ({ match: ENV_LINE.exec(line), at }));
  const token = entries.find(({ match }) => match?.[1] === TOKEN_VAR)?.match;
  return {
    path: file,
    token: token ? token[2].replace(/^(['"])(.*)\1$/, "$2") : undefined,
    others: entries
      .filter(({ match }) => match?.[1] !== TOKEN_VAR)
      .map(({ match, at }) => match?.[1] ?? `an unrecognised line ${at + 1}`),
  };
}

/**
 * Whether a token file really holds a token: what `start` refuses.
 * @param {ReturnType<typeof readEnvFile>} file - The file, if any
 * @returns {boolean} True for a `TELEGRAM_BOT_TOKEN` line
 */
export function holdsToken(file) {
  return file !== null && file.token !== undefined;
}

/**
 * Whether a file holds nothing at all (empty, blank or comments only), so
 * `store-token` may delete it once the provider holds a verified secret.
 * @param {ReturnType<typeof readEnvFile>} file - The file, if any
 * @returns {boolean} True for a removable empty file
 */
export function removable(file) {
  return file !== null && file.token === undefined && file.others.length === 0;
}

/**
 * Refuse a plaintext file that cannot be migrated as it is.
 * @param {ReturnType<typeof readEnvFile>} file - The file, if any
 */
export function assertMigratable(file) {
  if (file === null) return;
  if (file.others.length > 0) {
    throw setupError(
      `${file.path} holds ${file.others.join(", ")} besides ${TOKEN_VAR}, so ` +
        `it cannot be deleted after the token moves. Move the rest out of it, ` +
        `then run store-token again. Nothing was changed.`
    );
  }
  if (file.token !== undefined && !validateBotToken(file.token)) {
    throw setupError(
      `${file.path} holds a ${TOKEN_VAR} that does not look like a Telegram ` +
        `bot token. Fix or delete the file, then run store-token again. ` +
        `Nothing was changed.`
    );
  }
}

/**
 * Delete the plaintext file after the provider's copy is verified, and say
 * so: `migratedFrom` when its token moved, `deleted` whenever it went.
 * @param {ReturnType<typeof readEnvFile>} file - The file, if any
 * @param {Pick<import("node:fs"), "rmSync">} fs - Seam
 * @returns {{ migratedFrom?: string, deleted?: true }} What was removed
 */
export function removeAfterVerify(file, fs) {
  if (holdsToken(file)) {
    fs.rmSync(file.path);
    return { migratedFrom: file.path, deleted: true };
  }
  if (removable(file)) {
    fs.rmSync(file.path);
    return { deleted: true };
  }
  return {};
}

/**
 * The result for a secret the provider already holds (no write): a matching
 * or empty plaintext file is deleted; one holding a different token is kept
 * and refused.
 * @param {{ value: string }} existing - The stored secret
 * @param {ReturnType<typeof readEnvFile>} file - The plaintext file, if any
 * @param {{ cfg: object, name: string, fs: object }} input - Context
 * @returns {object} Outcome
 */
export function keepExisting(existing, file, { cfg, name, fs }) {
  const result = {
    stored: true,
    storage: "provider",
    provider: cfg.provider,
    secret: name,
    verified: true,
    alreadyStored: true,
  };
  if (!validateBotToken(existing.value)) {
    throw setupError(
      `${name} in ${cfg.provider} does not look like a Telegram bot token. ` +
        `Run store-token --replace to store the right one.`
    );
  }
  if (holdsToken(file) && digest(file.token) !== digest(existing.value)) {
    throw setupError(
      `${file.path} holds a different token from the one ${cfg.provider} ` +
        `already stores as ${name}. Nothing was changed. To make the file's ` +
        `token the stored one, run store-token --replace; to keep the stored ` +
        `one, delete ${file.path}.`
    );
  }
  return { ...result, ...removeAfterVerify(file, fs) };
}
