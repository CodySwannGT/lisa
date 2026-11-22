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
 *
 * The adapter and provider-error handling live in token-provider.mjs and the
 * plaintext-file migration helpers in token-migrate.mjs; this module keeps
 * the two flows and re-exports what the CLI imports.
 * @module session-manager/token-store
 */
import * as nodeFs from "node:fs";

import {
  TOKEN_VAR,
  TokenStoreError,
  assertMigratable,
  digest,
  holdsToken,
  keepExisting,
  readEnvFile,
  removeAfterVerify,
  setupError,
} from "./token-migrate.mjs";
import { guarded } from "./token-provider.mjs";
import { validateBotToken } from "./token.mjs";

export { TokenStoreError } from "./token-migrate.mjs";
export {
  classifyProviderFailure,
  defaultSecretsAdapter,
  loadTokenSecrets,
} from "./token-provider.mjs";

/** Providers whose secrets live in a project that a create must name. */
const PROJECT_SCOPED = new Set(["bitwarden"]);

/** The usage note stored with the secret (format: note-format.mjs). */
const NOTE = [
  "Telegram bot token for a Lisa session manager, stored by its store-token command and read only by its start command.",
  "scope: one Telegram bot - whoever holds it can read and send that bot's messages",
  "owner: lisa-session-manager",
].join("\n");

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

  const read = holdsToken(file)
    ? { token: file.token }
    : await input.readToken();
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
  return {
    stored: true,
    storage: "provider",
    provider: cfg.provider,
    secret: name,
    verified: true,
    ...removeAfterVerify(file, fs),
    ...(read.clear ? { clipboardCleared: read.clear() } : {}),
  };
}

/**
 * Resolve the bot token for `start`, once, from the provider. Refuses (exit
 * 2) a leftover plaintext file that holds a token line, naming `fixCommand`
 * (the `store-token` call that migrates it; an empty or comment-only file
 * holds nothing to migrate and does not stop `start`), an undeclared or
 * missing secret, and a value that is not
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
  const file = readEnvFile(input.stateDir, fs);
  if (holdsToken(file)) {
    throw setupError(
      `A plaintext Telegram bot token file is still at ${file.path}. With a ` +
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
