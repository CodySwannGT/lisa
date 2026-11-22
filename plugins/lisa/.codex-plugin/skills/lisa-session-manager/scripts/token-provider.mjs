/**
 * Talking to the secrets provider for the Telegram bot token (#4555): the
 * adapter over `lisa-secrets-access` (`surfaces.mjs` for the config,
 * `providers.mjs` for reads and writes), whether a provider is configured at
 * all, and turning a provider error into fixed operator text.
 *
 * Split from token-store.mjs, which keeps the store and resolve flows. The
 * adapter is injectable so tests run against a fake vault. A provider's raw
 * error is matched, never repeated: a failed write's error can quote its
 * argv, which holds the value.
 * @module session-manager/token-provider
 */
import { TokenStoreError, setupError } from "./token-migrate.mjs";

/** A provider error that names a rate limit (HTTP 429). */
const RATE_LIMITED = /\b429\b|too many requests|rate.?limit/i;

/** The bootstrap prefix whose CLI each provider runs, for the preflight. */
const CLI_PREFIX = { bitwarden: "BWS_ACCESS_TOKEN", doppler: "DOPPLER_TOKEN" };

/** Operator-facing reasons, by {@link classifyProviderFailure} kind. */
const REASONS = {
  "rate-limited": "it rate-limited the request (429 Too Many Requests)",
  "timed-out": "it did not answer in time",
  unavailable: "it could not be reached or refused the request",
};

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
export function providerError(error, { provider, name, retry }) {
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
 * Call the adapter, turning a provider error into a {@link TokenStoreError}.
 * @param {() => unknown} call - Adapter call
 * @param {{ provider: string, name: string, retry: string }} where - Context
 * @returns {Promise<unknown>} The call's result
 */
export async function guarded(call, where) {
  try {
    return await call();
  } catch (error) {
    throw providerError(error, where);
  }
}
