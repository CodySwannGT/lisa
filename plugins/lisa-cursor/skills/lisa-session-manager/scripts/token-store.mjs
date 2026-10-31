/**
 * The Telegram bot token held in the project's secrets provider (#4555).
 *
 * Before this, `store-token` wrote the token in plaintext to
 * `<notify.stateDir>/.env`: the only Lisa-managed secret outside the secrets
 * contract. When the project declares a secrets provider (`secrets.provider`
 * set and not `env`), the token instead lives in that provider under one
 * per-project name ({@link telegramSecretName}), and nothing is written to
 * disk:
 * - `store-token` stores it there: from a leftover plaintext file (migration)
 *   or from the operator's prompt or clipboard. It reads the secret back and
 *   compares hashes, and only then deletes the file.
 * - `start` resolves it once and hands it to tmux on stdin, never argv. A
 *   plaintext file left behind stops `start` with the exact command that
 *   migrates it. An unreachable, rate-limited or slow provider is a failure
 *   (exit 1) with retry guidance, never a fallback to a stale file.
 * With no provider configured the old `.env` path in token.mjs is unchanged.
 *
 * Every provider call goes through `lisa-secrets-access` (`surfaces.mjs` for
 * the config, `providers.mjs` for reads and writes), behind an injectable
 * adapter so tests run against a fake vault. The token is never returned to
 * the CLI, put in a message, or logged: errors carry fixed reason text, never
 * a provider's raw error, since a failed write's error can quote its argv.
 * @module session-manager/token-store
 */
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import path from "node:path";

import { validateBotToken } from "./token.mjs";

/** The plugin's plaintext token file in the state dir (the old storage). */
const TOKEN_FILE = ".env";

/** The variable the Telegram plugin reads its token from. */
const TOKEN_VAR = "TELEGRAM_BOT_TOKEN";

/** One `KEY=value` line of a dotenv file, optionally `export`ed. */
const ENV_LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** A provider error that names a rate limit (HTTP 429). */
const RATE_LIMITED = /\b429\b|too many requests|rate.?limit/i;

/** Providers whose secrets live in a project that a create must name. */
const PROJECT_SCOPED = new Set(["bitwarden"]);

/** The bootstrap prefix whose CLI each provider runs, for the preflight. */
const CLI_PREFIX = { bitwarden: "BWS_ACCESS_TOKEN", doppler: "DOPPLER_TOKEN" };

/** The usage note stored with the secret (format: note-format.mjs). */
const NOTE = [
  "Telegram bot token for a Lisa session manager, stored by its store-token command and read only by its start command.",
  "scope: one Telegram bot - whoever holds it can read and send that bot's messages",
  "owner: lisa-session-manager",
].join("\n");

/** Operator-facing reasons, by {@link classifyProviderFailure} kind. */
const REASONS = {
  "rate-limited": "it rate-limited the request (429 Too Many Requests)",
  "timed-out": "it did not answer in time",
  unavailable: "it could not be reached or refused the request",
};

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
const setupError = message => new TokenStoreError(message, 2);

/**
 * The provider secret name for one manager: `TELEGRAM_BOT_TOKEN_<NAME>`, with
 * the manager name upper-snaked. The `TELEGRAM_` prefix keeps
 * `scrubWorkerEnv` stripping it from every worker's environment.
 * @param {string} managerName - `sessionManager.name`, e.g. `lisa-1a2b-manager`
 * @returns {string} e.g. `TELEGRAM_BOT_TOKEN_LISA_1A2B_MANAGER`
 */
export function telegramSecretName(managerName) {
  const suffix = String(managerName)
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_");
  return `${TOKEN_VAR}_${suffix}`;
}

/**
 * What went wrong talking to the provider, read from the error's code and
 * text only (the text is matched, never repeated).
 * @param {unknown} error - Caught value
 * @returns {"setup" | "missing-cli" | "timed-out" | "rate-limited" |
 *   "unsupported" | "duplicate" | "unavailable"} Kind
 */
export function classifyProviderFailure(error) {
  const text = `${error?.message ?? ""} ${error?.stderr ?? ""}`;
  if (error?.kind === "setup") return "setup";
  if (error?.code === "ENOENT") return "missing-cli";
  if (error?.code === "ETIMEDOUT" || /at its own deadline/.test(text)) {
    return "timed-out";
  }
  if (RATE_LIMITED.test(text)) return "rate-limited";
  if (/has no (bulk read|create|write) implemented/.test(text)) {
    return "unsupported";
  }
  if (/duplicate secret key/.test(text)) return "duplicate";
  return "unavailable";
}

/**
 * Turn a provider error into a {@link TokenStoreError} with fixed text.
 * @param {unknown} error - Caught value
 * @param {{ provider: string, name: string, retry: string }} where - The
 *   provider, the secret, and the retry advice for a transient failure
 * @returns {TokenStoreError} Error
 */
function providerError(error, { provider, name, retry }) {
  const kind = classifyProviderFailure(error);
  if (kind === "setup") return setupError(String(error.message));
  if (kind === "missing-cli") {
    return setupError(
      `The ${provider} command-line tool is not on PATH. Install it with ` +
        `/lisa:setup:workstation, then try again.`
    );
  }
  if (kind === "unsupported") {
    return setupError(
      `Lisa cannot read or write ${name} in provider "${provider}" yet. ` +
        `Create ${name} in ${provider} yourself, then run store-token to ` +
        `verify it and remove any plaintext copy.`
    );
  }
  if (kind === "duplicate") {
    return setupError(
      `${provider} shows more than one secret with the same name, so Lisa ` +
        `will not guess which is ${name}. Remove the duplicate in ${provider}.`
    );
  }
  return new TokenStoreError(`${retry.replace("<reason>", REASONS[kind])}`, 1);
}

/**
 * The lazily-loaded secrets adapter over `lisa-secrets-access`, by path
 * relative to this file (the way token.mjs loads prompt-secret.mjs).
 * @returns {Promise<{ readConfig: Function, preflight: Function,
 *   list: Function, create: Function, replace: Function }>} Adapter
 */
export async function defaultSecretsAdapter() {
  const base = new URL("../../lisa-secrets-access/scripts/", import.meta.url);
  const [surfaces, providers] = await Promise.all([
    import(new URL("surfaces.mjs", base).href),
    import(new URL("providers.mjs", base).href),
  ]);
  return {
    readConfig: (root, env) => surfaces.readConfig(root, env),
    preflight: cfg => {
      const prefix = CLI_PREFIX[cfg.provider];
      if (prefix && providers.providerCliPresent(prefix) === false) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      try {
        providers.bootstrapToken(cfg.bootstrap);
      } catch (error) {
        throw Object.assign(new Error(error.message), { kind: "setup" });
      }
    },
    list: cfg =>
      [...providers.normalizeRows(providers.fetchRaw(cfg), cfg.narrow)].map(
        ([key, row]) => ({ key, ...row })
      ),
    create: (cfg, secret) => providers.createSecret(cfg, secret),
    replace: (cfg, { id, value }) => providers.writeSecret(cfg, id, value),
  };
}

/**
 * The project's secrets config and adapter, or `null` when no provider is
 * configured (no `secrets` block, or `provider: "env"`): then the token stays
 * in the state dir's `.env` file.
 * @param {string} root - Project root
 * @param {Record<string, string | undefined>} env - Environment
 * @param {object} [adapter] - Injected adapter (tests)
 * @returns {Promise<{ cfg: object, adapter: object } | null>} Provider mode
 */
export async function loadTokenSecrets(root, env, adapter) {
  const secrets = adapter ?? (await defaultSecretsAdapter());
  let cfg;
  try {
    cfg = secrets.readConfig(root, env);
  } catch (error) {
    throw setupError(`Could not read the secrets config: ${error.message}`);
  }
  const configured =
    typeof cfg?.provider === "string" && cfg.provider !== "env";
  return configured ? { cfg, adapter: secrets } : null;
}

/**
 * Refuse a name the project's `secrets.require` allowlist does not declare:
 * the provider would never hand it to this project.
 * @param {{ require?: string[] | null }} cfg - Secrets config
 * @param {string} name - Secret name
 */
function assertDeclared(cfg, name) {
  if (Array.isArray(cfg.require) && !cfg.require.includes(name)) {
    throw setupError(
      `${name} is not declared in secrets.require in .lisa.config.json, so ` +
        `this project may not read it. Add "${name}" to secrets.require, ` +
        `then run this again.`
    );
  }
}

/**
 * sha256 of a value, for comparing a written secret with its read-back.
 * @param {string} value - Value
 * @returns {string} Hex digest
 */
function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

/**
 * Read the plaintext token file, if there is one: its token, and the names
 * of anything else in it (values are never kept or reported).
 * @param {string} stateDir - Resolved state dir
 * @param {Pick<typeof nodeFs, "existsSync" | "readFileSync">} fs - Seam
 * @returns {{ path: string, token: string | undefined, others: string[] } |
 *   null} The file, or null when absent
 */
function readEnvFile(stateDir, fs) {
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
 * Call the adapter, turning a provider error into a {@link TokenStoreError}.
 * @param {() => unknown} call - Adapter call
 * @param {{ provider: string, name: string, retry: string }} where - Context
 * @returns {Promise<unknown>} The call's result
 */
async function guarded(call, where) {
  try {
    return await call();
  } catch (error) {
    throw providerError(error, where);
  }
}

/**
 * The provider project a new secret goes in: `--vault-project`, else the one
 * project `secrets.narrow.projectIds` names, else the one project every
 * visible secret lives in. Exit 2 rather than guess.
 * @param {object} cfg - Secrets config
 * @param {Array<{ projectId: string | null }>} rows - Visible secrets
 * @param {{ name: string, vaultProject?: string }} input - Secret and flag
 * @returns {string | undefined} Project id (undefined: provider has none)
 */
function chooseProject(cfg, rows, { name, vaultProject }) {
  if (!PROJECT_SCOPED.has(cfg.provider)) return undefined;
  const narrowed = cfg.narrow?.projectIds ?? [];
  if (vaultProject) {
    if (narrowed.length > 0 && !narrowed.includes(vaultProject)) {
      throw setupError(
        `--vault-project ${vaultProject} is not in secrets.narrow.projectIds, ` +
          `so ${name} would be stored where this project cannot read it.`
      );
    }
    return vaultProject;
  }
  if (narrowed.length === 1) return narrowed[0];
  const seen = [...new Set(rows.map(row => row.projectId).filter(Boolean))];
  if (seen.length === 1) return seen[0];
  throw setupError(
    `Cannot tell which ${cfg.provider} project to store ${name} in ` +
      `(${seen.length} projects are visible). Run store-token again with ` +
      `--vault-project <project id>.`
  );
}

/**
 * The result for a secret the provider already holds (no write): a matching
 * plaintext file is deleted; a different one is kept and refused.
 * @param {{ value: string }} existing - The stored secret
 * @param {ReturnType<typeof readEnvFile>} file - The plaintext file, if any
 * @param {{ cfg: object, name: string, fs: object }} input - Context
 * @returns {object} Outcome
 */
function keepExisting(existing, file, { cfg, name, fs }) {
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
  if (file?.token === undefined) return result;
  if (digest(file.token) !== digest(existing.value)) {
    throw setupError(
      `${file.path} holds a different token from the one ${cfg.provider} ` +
        `already stores as ${name}. Nothing was changed. To make the file's ` +
        `token the stored one, run store-token --replace; to keep the stored ` +
        `one, delete ${file.path}.`
    );
  }
  fs.rmSync(file.path);
  return { ...result, migratedFrom: file.path, deleted: true };
}

/**
 * Refuse a plaintext file that cannot be migrated as it is.
 * @param {ReturnType<typeof readEnvFile>} file - The file, if any
 */
function assertMigratable(file) {
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
 * Store the bot token in the secrets provider: look it up, take it from the
 * plaintext file (migration) or `readToken` (prompt or clipboard), create or
 * replace it, read it back and compare hashes, and only then delete the
 * file. An existing secret is kept unless `replace`.
 * @param {{ cfg: object, adapter: object, name: string, stateDir: string,
 *   replace?: boolean, vaultProject?: string,
 *   readToken: () => Promise<{ token?: string, clear?: () => boolean,
 *     stored?: boolean, reason?: string, message?: string }>,
 *   fs?: object }} input - Config, adapter, secret
 *   name, resolved state dir, flags, the token reader and an fs seam
 * @returns {Promise<object>} `{stored:true,storage:"provider",...}`, or the
 *   reader's `{stored:false,...}` outcome
 */
export async function storeTokenInProvider(input) {
  const { cfg, adapter, name, replace = false, fs = nodeFs } = input;
  const where = {
    provider: cfg.provider,
    name,
    retry:
      `Could not store the Telegram bot token in ${cfg.provider}: <reason>. ` +
      `Nothing was stored and any plaintext token file was kept. Wait a ` +
      `minute and run store-token again.`,
  };
  assertDeclared(cfg, name);
  const file = readEnvFile(input.stateDir, fs);
  assertMigratable(file);
  await guarded(() => adapter.preflight(cfg), where);
  const rows = await guarded(() => adapter.list(cfg), where);
  const existing = rows.find(row => row.key === name);
  if (existing && !replace) {
    return keepExisting(existing, file, { cfg, name, fs });
  }

  const read =
    file?.token === undefined ? await input.readToken() : { token: file.token };
  if (read.token === undefined) return read;
  const projectId = existing ? undefined : chooseProject(cfg, rows, input);
  await guarded(
    () =>
      existing
        ? adapter.replace(cfg, { id: existing.id, value: read.token })
        : adapter.create(cfg, {
            name,
            value: read.token,
            projectId,
            note: NOTE,
          }),
    where
  );
  const after = (await guarded(() => adapter.list(cfg), where)).find(
    row => row.key === name
  );
  if (after === undefined || digest(after.value) !== digest(read.token)) {
    throw new TokenStoreError(
      `Reading ${name} back from ${cfg.provider} did not return what was ` +
        `written, so the token is not proven stored. Any plaintext token ` +
        `file was kept. Run store-token again.`,
      1
    );
  }
  const migrated = file?.token !== undefined;
  if (migrated) fs.rmSync(file.path);
  return {
    stored: true,
    storage: "provider",
    provider: cfg.provider,
    secret: name,
    verified: true,
    ...(migrated ? { migratedFrom: file.path, deleted: true } : {}),
    ...(read.clear ? { clipboardCleared: read.clear() } : {}),
  };
}

/**
 * Resolve the bot token for `start`, once, from the provider. Refuses (exit
 * 2) a leftover plaintext file, naming `fixCommand` (the `store-token` call
 * that migrates it), an undeclared or missing secret, and a value that is not
 * bot-token shaped; fails (exit 1) when the provider is unreachable,
 * rate-limited or slow, saying nothing was started.
 * @param {{ cfg: object, adapter: object, name: string, stateDir: string,
 *   fixCommand: string, fs?: object }} input - Config, adapter, secret name,
 *   resolved state dir, the migrating command and an fs seam
 * @returns {Promise<string>} The token, for the tmux stdin line only
 */
export async function resolveTelegramToken(input) {
  const { cfg, adapter, name, fixCommand, fs = nodeFs } = input;
  assertDeclared(cfg, name);
  const file = path.join(input.stateDir, TOKEN_FILE);
  if (fs.existsSync(file)) {
    throw setupError(
      `A plaintext Telegram bot token file is still at ${file}. With a ` +
        `secrets provider configured the token must live in ` +
        `${cfg.provider} only. Nothing was started. Move it there (this ` +
        `stores the token, verifies it and deletes the file), then run start ` +
        `again:\n  ${fixCommand}`
    );
  }
  const where = {
    provider: cfg.provider,
    name,
    retry:
      `Could not read the Telegram bot token from ${cfg.provider}: ` +
      `<reason>. Nothing was started. Wait a minute and run start again; if ` +
      `it keeps failing, check ${cfg.provider}'s status and this machine's ` +
      `network.`,
  };
  await guarded(() => adapter.preflight(cfg), where);
  const rows = await guarded(() => adapter.list(cfg), where);
  const hit = rows.find(row => row.key === name);
  if (!hit?.value) {
    throw setupError(
      `${cfg.provider} has no secret named ${name}, so the manager has no ` +
        `bot token. Nothing was started. Store it with:\n  ${fixCommand}`
    );
  }
  if (!validateBotToken(hit.value)) {
    throw setupError(
      `${name} in ${cfg.provider} does not look like a Telegram bot token. ` +
        `Nothing was started. Run store-token --replace to store the right one.`
    );
  }
  return hit.value;
}
