#!/usr/bin/env node
/**
 * Provider reads and boundary enforcement for `lisa-secrets-access`.
 *
 * Retrieval and selection are separated deliberately. `fetchRaw` is the only
 * function that touches a provider; everything downstream operates on plain
 * rows, which is what makes the boundary rules testable with synthetic data and
 * without granting a test process access to any real secret.
 * @module providers
 */

import { readBootstrapFile } from "./bootstrap-store.mjs";

import {
  boundedChildOutput,
  rethrowIfChildTimeout,
} from "../../lisa-setup-workstation/scripts/bounded-child.mjs";

/**
 * A provider key becomes a shell variable name on materializing surfaces, so
 * only names valid in every POSIX-like shell are accepted. Anything else stays
 * in the provider and is intentionally not exported.
 */
export const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The provider entry holding rotation leases.
 *
 * Leases live in the provider because it is the only substrate every surface
 * shares — a CI concurrency group and a laptop lockfile cannot see each other,
 * but both can see this. It is coordination state rather than a credential, so
 * it is excluded from every selection: nothing should resolve or materialize it.
 */
export const LEASE_KEY = "LISA_ROTATION_LEASES";

/**
 * Prefix reserved for provider-side coordination records.
 *
 * These records contain no credential material. They exist only long enough
 * to serialize a provider mutation and must never cross the exposure boundary
 * into a shell, file, hook, or CI environment.
 */
export const COORDINATION_KEY_PREFIX = "LISA_COORDINATION_";

const COORDINATION_VALUE = "coordination-only";

/**
 * The environment variable each provider's CLI reads its own bootstrap from.
 *
 * This is deliberately *not* configurable, and separating it from
 * `bootstrap.key` is the whole point. Two different questions were previously
 * answered by one value:
 *
 * - **Where do we find the bootstrap?** A keychain service or environment
 *   variable name. That must be configurable, because one workstation serves
 *   several tenants and each needs its own token stored under its own name.
 * - **What does the provider CLI call it?** Fixed by the vendor. `bws` reads
 *   `BWS_ACCESS_TOKEN` and nothing else.
 *
 * Conflating them worked only while every project used the default name, where
 * the two happen to coincide. The moment a project set
 * `bootstrap.key: "BWS_ACCESS_TOKEN_<tenant>"` the CLI was handed a variable it
 * has never heard of and failed with "Missing access token".
 */
const PROVIDER_BOOTSTRAP_ENV = {
  bitwarden: "BWS_ACCESS_TOKEN",
  doppler: "DOPPLER_TOKEN",
};

/**
 * The tenant-scoped bootstrap variable a provider expects, by convention.
 *
 * Exists so the repo-less path cannot invent one. It used to compose
 * `BWS_ACCESS_TOKEN_<namespace>` literally, ignoring the provider it had just
 * resolved — so a Doppler tenant with no checkout was told to set a Bitwarden
 * variable, and its CLI failed with "Missing access token". That is precisely
 * the confusion the two questions above are separated to prevent, reintroduced
 * on the one surface with no config file to correct it.
 *
 * `null` for a provider with no env-var bootstrap — 1Password, Vault and AWS
 * authenticate by other means — because a name invented for them would be a
 * variable nothing reads, which is worse than admitting there is none.
 * `providerEnv` already treats an unmapped provider as "inject nothing".
 * @param {string} provider Provider name.
 * @param {string} namespace Tenant namespace.
 * @returns {string|null} The variable to set, or null when the provider has none.
 */
export function bootstrapKeyFor(provider, namespace) {
  const canonical = PROVIDER_BOOTSTRAP_ENV[provider];
  return canonical ? `${canonical}_${namespace}` : null;
}

/**
 * Build the child environment for a provider CLI, injecting the bootstrap under
 * the name that CLI actually reads.
 *
 * Both the read path and the rotation write path need this, and they previously
 * carried separate copies of the same line — which is how they would eventually
 * have drifted. One helper, one place to be wrong.
 * @param {object} cfg Resolved configuration.
 * @returns {NodeJS.ProcessEnv} Environment for the child process.
 */
export function providerEnv(cfg) {
  const env = { ...process.env };
  const canonical = PROVIDER_BOOTSTRAP_ENV[cfg.provider];
  if (!canonical) return env;
  const token = bootstrapToken(cfg.bootstrap);
  if (token) env[canonical] = token;
  // Drop the tenant-scoped name once its value has been placed under the one
  // the CLI reads. Inheriting it would leave two variables holding the same
  // bootstrap in the child, which is how a tool that probes for a
  // similarly-named credential binds to the wrong tenant on a workstation
  // serving several. The child needs exactly one.
  if (cfg.bootstrap.key && cfg.bootstrap.key !== canonical) {
    delete env[cfg.bootstrap.key];
  }
  return env;
}

/**
 * Obtain the one credential that unlocks the provider.
 *
 * Walks `sources` in order, environment first, so a CI run where the pipeline
 * injects the bootstrap never reaches for a local store. This is the only
 * credential permitted in an OS keychain — it is a bootstrap, not a cached copy
 * of anything downstream.
 * @param {{sources: string[], key: string|null}} bootstrap Bootstrap config.
 * @returns {string|null} The token, or null when the provider needs none.
 */
export function bootstrapToken(bootstrap) {
  if (!bootstrap.key) return null;
  for (const source of bootstrap.sources) {
    const found =
      source === "env"
        ? (process.env[bootstrap.key] ?? "").trim()
        : source === "keychain"
          ? fromKeychain(bootstrap.key)
          : "";
    if (found) return found;
  }
  throw new Error(
    `${bootstrap.key} not found in: ${bootstrap.sources.join(", ")}.\n` +
      `It is the bootstrap credential — without it no other secret can be read.`
  );
}

/**
 * Read one value from this machine's credential store, treating absence as
 * empty.
 *
 * The `keychain` source names a role, not a macOS API: "wherever this machine
 * keeps its bootstrap". On macOS that is the keychain. Elsewhere there is no
 * store that can be assumed present — libsecret needs a daemon and a desktop
 * session, which a server or container does not have — so it is a `0600` file,
 * the same protection the materialized secrets file already relies on.
 *
 * Returning empty on the other platform, as this did before, meant a Linux
 * machine could store a bootstrap and never read it back.
 * @param {string} key Bootstrap variable name.
 * @returns {string} The value, or an empty string when unavailable.
 */
function fromKeychain(key) {
  try {
    // Inside the `try`, not before it. `readBootstrapFile` uses `readFileSync`,
    // which throws on a permission error, on EISDIR, and when the file is
    // removed between the existence check and the read. This function's
    // contract is to return empty when the value is unavailable, and
    // `bootstrapToken` has no handler — so a raw filesystem error would
    // replace the curated "not found in: ..." message with a stack trace.
    if (process.platform !== "darwin") return readBootstrapFile(key);
    return boundedChildOutput(
      "security",
      ["find-generic-password", "-s", key, "-a", process.env.USER ?? "", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch (error) {
    // A killed child must not read as "this provider has no such
    // secret" — that is a claim about the vault, and the caller acts on it.
    rethrowIfChildTimeout(error);
    return "";
  }
}

/**
 * Read every secret the provider grants, as unfiltered rows.
 *
 * Deliberately reads all rather than one: the provider already scopes what this
 * caller may see, so the set it returns *is* the permitted set. Restating that
 * as a list in config would duplicate a boundary the provider already enforces.
 * @param {object} cfg Resolved configuration.
 * @returns {Array<{key: string, value: string, note: string, projectId: string|null, id?: string|null, creationDate?: string|null, revisionDate?: string|null}>} Rows.
 */
export function fetchRaw(cfg) {
  const env = providerEnv(cfg);

  if (cfg.provider === "env") {
    return Object.entries(process.env)
      .filter(([k]) => /^[A-Z][A-Z0-9_]*$/.test(k))
      .map(([key, value]) => ({
        key,
        value: value ?? "",
        note: "",
        projectId: null,
      }));
  }

  if (cfg.provider === "bitwarden") {
    const raw = run("bws", ["secret", "list", "--output", "json"], env);
    return JSON.parse(raw || "[]").map(s => ({
      key: s.key,
      value: s.value,
      note: s.note ?? "",
      projectId: s.projectId ?? null,
      id: s.id ?? null,
      creationDate: s.creationDate ?? null,
      revisionDate: s.revisionDate ?? null,
    }));
  }

  if (cfg.provider === "doppler") {
    const args = ["secrets", "download", "--no-file", "--format", "json"];
    const raw = run("doppler", args, env);
    return Object.entries(JSON.parse(raw || "{}")).map(([key, value]) => ({
      key,
      value: String(value),
      note: "",
      projectId: null,
    }));
  }

  throw new Error(
    `provider "${cfg.provider}" has no bulk read implemented yet.\n` +
      `Add one in providers.mjs — see the dispatch table in SKILL.md.`
  );
}

/**
 * Run a provider CLI, keeping its output off any shared stream.
 * @param {string} bin Executable name.
 * @param {string[]} args Arguments.
 * @param {NodeJS.ProcessEnv} env Environment for the child.
 * @returns {string} Captured stdout.
 */
function run(bin, args, env) {
  return boundedChildOutput(bin, args, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Apply the exposure boundary and reject an ambiguous set.
 *
 * The provider's own scoping is the default allowlist. The optional controls
 * may only *narrow* it — there is intentionally no way to widen access from
 * config, because that boundary belongs to the provider grant.
 *
 * A duplicate exact-name key is fatal rather than last-wins. Silently choosing
 * one would make which credential gets used depend on provider response order,
 * which is neither stable nor visible at the call site.
 * @param {Array<object>} rows Raw provider rows.
 * @param {{projectIds: string[], excludeKeys: string[]}} narrow Narrowing controls.
 * @returns {Map<string, {value: string, note: string, id: string|null, projectId: string|null, creationDate: string|null, revisionDate: string|null}>} Selected secrets by name.
 */
export function normalizeRows(
  rows,
  narrow = { projectIds: [], excludeKeys: [] }
) {
  const projects = new Set(narrow.projectIds ?? []);
  const excluded = new Set([...(narrow.excludeKeys ?? []), LEASE_KEY]);
  const out = new Map();

  for (const row of rows) {
    if (projects.size && !projects.has(row.projectId)) continue;
    if (
      typeof row.key === "string" &&
      row.key.startsWith(COORDINATION_KEY_PREFIX)
    ) {
      continue;
    }
    if (typeof row.key !== "string" || !ENV_KEY.test(row.key)) continue;
    if (excluded.has(row.key)) continue;
    if (out.has(row.key)) {
      throw new Error(
        `duplicate secret key across visible projects: ${row.key}.\n` +
          `Resolve it at the provider — choosing one here would make credential ` +
          `use depend on response order.`
      );
    }
    if (typeof row.value !== "string") {
      throw new Error(`secret value is not a string: ${row.key}`);
    }
    out.set(row.key, {
      value: row.value,
      note: row.note ?? "",
      id: row.id ?? null,
      projectId: row.projectId ?? null,
      creationDate: row.creationDate ?? null,
      revisionDate: row.revisionDate ?? null,
    });
  }
  return out;
}

/**
 * Apply the reviewed `secrets.require` allowlist to the ordinary provider view.
 *
 * Omitted `require` keeps the provider grant as the boundary. Once a project
 * names a required set, every other visible record is outside that project's
 * declared need and must not resolve or materialize. Missing required names are
 * refused here rather than becoming a smaller, apparently successful view.
 * @param {Map<string, {value: string, note: string, id: string|null}>} selected Provider rows after grant narrowing.
 * @param {string[]|null|undefined} required Exact required names, or no project allowlist.
 * @returns {Map<string, {value: string, note: string, id: string|null}>} The declared provider view.
 */
export function selectRequired(selected, required) {
  if (required === null || required === undefined) return selected;

  const missing = required.filter(name => !selected.has(name));
  if (missing.length > 0) {
    throw new Error(
      `required secret${missing.length === 1 ? "" : "s"} not found: ` +
        `${missing.join(", ")}.\n` +
        `Check the provider grant, secrets.narrow, and the exact names in ` +
        `secrets.require.`
    );
  }

  return new Map(required.map(name => [name, selected.get(name)]));
}

/**
 * Read the provider grant through the ordinary narrowing controls, then expose
 * exactly the names authorised by one consumer.
 *
 * This does not widen the provider grant and deliberately does not reuse
 * `cfg.require`: that declaration controls ordinary resolution and
 * materialization, while specialized consumers such as propagation carry
 * their own reviewed exact-name authorization. Keeping those views separate
 * prevents a propagating-only credential from being written to a materialized
 * secrets file merely to make the propagation command able to read it.
 *
 * Provider retrieval itself remains bounded by the provider account's grant.
 * Supported bulk-read providers return that granted view before this process
 * applies the narrower consumer allowlist.
 * @param {object} cfg Resolved configuration.
 * @param {string[]|null|undefined} required Exact names authorised for this consumer.
 * @returns {Map<string, {value: string, note: string, id: string|null}>} The consumer-specific provider view.
 */
export function fetchNamed(cfg, required) {
  return selectRequired(normalizeRows(fetchRaw(cfg), cfg.narrow), required);
}

/**
 * Read and select in one step — the normal entry point for consumers.
 * @param {object} cfg Resolved configuration.
 * @returns {Map<string, {value: string, note: string, id: string|null}>} Selected secrets.
 */
export function fetchAll(cfg) {
  return fetchNamed(cfg, cfg.require);
}

/**
 * The provider view the rotation path reads.
 *
 * `excludeKeys` keeps a credential off a **surface's disk**. Applying it here
 * too hid the provider record, making `rotating` and `excludeKeys` mutually
 * exclusive — and a credential you cannot see is one you cannot write back to.
 * That is backwards for a consumable credential: the kind you least want
 * materialized is the kind that most needs a proven write path.
 *
 * Nothing here materializes anything. `fetchAll` remains the only view feeding
 * a surface, so an excluded rotating credential still never reaches disk.
 * @param {object} cfg Resolved configuration.
 * @returns {Map<string, {value: string, note: string, id: string|null}>} Selected secrets by name.
 */
export function fetchRotatable(cfg) {
  return normalizeRows(fetchRaw(cfg), rotationNarrow(cfg));
}

/**
 * Narrowing for the rotation view: project grants intact, `excludeKeys` waived
 * for declared rotating names only.
 *
 * The waiver reaches only names in `secrets.rotating` — config, and therefore
 * reviewed, the same declared-never-inferred rule the write path enforces.
 * Project narrowing is the provider's own boundary and is never widened. Split
 * from {@link fetchRotatable} so the decision is testable without a provider.
 * @param {object} cfg Resolved configuration.
 * @returns {{projectIds: string[], excludeKeys: string[]}} Narrowing controls.
 */
export function rotationNarrow(cfg) {
  const rotating = new Set(cfg.rotating ?? []);
  return {
    projectIds: cfg.narrow?.projectIds ?? [],
    excludeKeys: (cfg.narrow?.excludeKeys ?? []).filter(
      key => !rotating.has(key)
    ),
  };
}

/**
 * Find one raw row by exact key, bypassing the exposure boundary.
 *
 * Only the rotation path uses this, and only to reach the lease record, which
 * is deliberately excluded from every normal selection. Reading a *credential*
 * must always go through {@link fetchAll} so the boundary applies.
 * @param {object} cfg Resolved configuration.
 * @param {string} key Exact key name.
 * @returns {object|null} The raw row, or null when absent.
 */
export function rawByKey(cfg, key) {
  const matches = fetchRaw(cfg).filter(row => row.key === key);
  if (matches.length > 1) throw new Error(`duplicate secret key: ${key}`);
  return matches[0] ?? null;
}

/**
 * Write a replacement value back to the provider.
 *
 * Passing a value as an argument is normally forbidden, because process
 * arguments are visible to anyone who can run `ps` on the same host. The
 * Bitwarden CLI exposes no stdin path for an edit, so this is a documented
 * exception rather than an oversight: it is confined to the one operation that
 * cannot be expressed otherwise, and `execFileSync` at least keeps the value
 * out of a shell and therefore out of shell history.
 * @param {object} cfg Resolved configuration.
 * @param {string} id Provider-side identifier for the secret.
 * @param {string} value Replacement value.
 */
export function writeSecret(cfg, id, value) {
  const env = providerEnv(cfg);

  if (cfg.provider === "bitwarden") {
    run("bws", ["secret", "edit", id, "--value", value], env);
    return;
  }
  throw new Error(
    `provider "${cfg.provider}" has no write implemented.\n` +
      `Rotation requires a proven write path; add one in providers.mjs.`
  );
}

/**
 * Create one provider-issued publication contender in the target project.
 *
 * The deliberately constrained interface accepts no value: coordination
 * records always contain the same public sentinel, which prevents this helper
 * from becoming an alternate credential-write path.
 * @param {object} cfg Resolved configuration.
 * @param {string} key Unique coordination key.
 * @param {string} projectId Project containing the target provider record.
 * @param {string} note Non-sensitive lifecycle metadata.
 * @returns {object} The provider-issued coordination row.
 */
export function createCoordinationRecord(cfg, key, projectId, note) {
  const env = providerEnv(cfg);

  if (cfg.provider === "bitwarden") {
    const raw = run(
      "bws",
      [
        "secret",
        "create",
        key,
        COORDINATION_VALUE,
        projectId,
        "--note",
        note,
        "--output",
        "json",
      ],
      env
    );
    const created = JSON.parse(raw);
    return {
      key: created.key,
      value: created.value,
      note: created.note ?? "",
      projectId: created.projectId ?? null,
      id: created.id ?? null,
      creationDate: created.creationDate ?? null,
      revisionDate: created.revisionDate ?? null,
    };
  }
  throw new Error(
    `provider "${cfg.provider}" has no coordination-record creation implemented.\n` +
      `AWS bootstrap publication requires a provider-backed single-writer lock.`
  );
}

/**
 * Remove one provider-side coordination record by its provider identifier.
 * @param {object} cfg Resolved configuration.
 * @param {string} id Provider-side identifier for the coordination record.
 */
export function removeCoordinationRecord(cfg, id) {
  const env = providerEnv(cfg);

  if (cfg.provider === "bitwarden") {
    run("bws", ["secret", "delete", id, "--output", "none"], env);
    return;
  }
  throw new Error(
    `provider "${cfg.provider}" has no coordination-record deletion implemented.\n` +
      `AWS bootstrap publication requires verified lock cleanup.`
  );
}
