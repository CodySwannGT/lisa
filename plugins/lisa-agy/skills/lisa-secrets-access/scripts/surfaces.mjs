#!/usr/bin/env node
/**
 * Surface definitions and configuration for `lisa-secrets-access`.
 *
 * A *provider* is where secrets live. A *surface* is where the running code
 * lives, and it determines how secrets reach that code. These are independent
 * axes: the same Bitwarden project serves a laptop, a CI runner, and a remote
 * agent container, but each of the three obtains its values differently.
 *
 * Surfaces are declared by capability rather than by name so adding one is a
 * single entry here rather than a new branch in every consumer. That is the
 * whole reason this table exists.
 * @module surfaces
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { bootstrapKeyFor } from "./providers.mjs";
import { routingFloor } from "./routing-floor.mjs";

/**
 * Capabilities, per surface.
 *
 * `materialized` — the surface obtains values from files written before the
 * code ran, so the resolver must consult them.
 *
 * `mayWriteValues` — the surface is permitted to write resolved values to
 * disk. This is normally forbidden, because a value on disk is a copy that can
 * drift and leak. It is *required* on surfaces whose bootstrap runs before the
 * consuming process exists and which therefore have no other channel; a remote
 * agent container prepares itself during setup, long before any task starts.
 *
 * `materializeAt` — *when* the write happens, for surfaces that do one. The two
 * remote surfaces share the capability but not the timing, and a reader adding a
 * third should not assume otherwise. `codex-cloud` re-runs its setup script when
 * a container resumes, so materializing during setup picks up a rotated value.
 * `claude-web` *skips* its setup script whenever a filesystem cache exists, so
 * materializing there would strand a rotated value until the cache expired —
 * it materializes from a session-start hook instead, which runs every session.
 *
 * Stated as a capability rather than inferred from the surface name, so the
 * setup runner selects its phases from the table instead of branching on which
 * vendor it happens to be talking to.
 */
export const SURFACES = {
  local: { materialized: false, mayWriteValues: false, materializeAt: null },
  "github-actions": {
    materialized: false,
    mayWriteValues: false,
    materializeAt: null,
  },
  "codex-cloud": {
    materialized: true,
    mayWriteValues: true,
    materializeAt: "setup",
  },
  "claude-web": {
    materialized: true,
    mayWriteValues: true,
    // BOTH, and the two cover disjoint failures rather than duplicating work.
    //
    // The hook alone was the original design, for a real reason: this surface
    // skips its setup script whenever a cached environment exists, so
    // materializing only there would write values once and never refresh them.
    //
    // What that missed is that the hook is PROJECT-scoped — it lives in a
    // repository's `.claude/settings.json` and only loads when Claude Code's
    // project directory is that repository. A cloud environment configured with
    // more than one repository starts in their parent:
    //
    //     HOME=/root  PWD=/home/user
    //     /home/user/backend  /home/user/infrastructure
    //
    // `/home/user` is not a project root, so no settings load, no hook
    // registers, and nothing materializes at all. Verified in a real session.
    //
    // So the setup run is the FLOOR — a fresh environment has its secrets even
    // where the hook cannot fire — and the hook is the REFRESH, picking up
    // rotation on resumed sessions that skip setup. A stale secret is
    // recoverable; an absent one means the environment does not work.
    materializeAt: "both",
  },
  // A container an operator builds and runs themselves — locally, or anywhere
  // Lisa is not the one provisioning the host.
  //
  // It exists because `local` was standing in for it, and `local` is
  // `materialized: false`. That default is right for a human at a keyboard: the
  // provider CLI is authenticated, secrets resolve live, and writing them to
  // disk would be a second copy to keep honest. A container has no keychain and
  // dies with its filesystem, so the same default leaves it with the CLIs
  // installed and nothing to authenticate them.
  //
  // The workaround was to claim `claude-web`, which materializes correctly and
  // is a lie — it made a local container indistinguishable from a cloud session
  // in every diagnostic and log.
  //
  // `setup` rather than `both`: a container has no session-start hook to run,
  // and it is started fresh rather than resumed from a vendor's cache, so the
  // start of the container IS the refresh.
  container: {
    materialized: true,
    mayWriteValues: true,
    materializeAt: "setup",
  },
};

/** Config defaults when `.lisa.config.json` carries no `secrets` block. */
const DEFAULTS = {
  provider: "env",
  bootstrap: { sources: ["env"], key: null },
  require: null,
  rotating: [],
  namespace: "lisa",
  narrow: { projectIds: [], excludeKeys: [] },
  surface: null,
};

/**
 * Identify the surface this process is running on.
 *
 * An explicit value always wins, so an operator can reproduce another
 * surface's behaviour locally when diagnosing one. Detection is otherwise
 * ordered most-specific first.
 * @param {string|null} [configured] Surface named in `.lisa.config.json`.
 * @param {Record<string, string|undefined>} [env] Environment to inspect.
 * @returns {string} A key of {@link SURFACES}.
 */
export function detectSurface(configured = null, env = process.env) {
  const explicit = (env.LISA_SECRETS_SURFACE ?? "").trim() || configured;
  if (explicit) {
    if (!SURFACES[explicit]) {
      throw new Error(
        `unknown surface "${explicit}".\n` +
          `Known: ${Object.keys(SURFACES).join(", ")}`
      );
    }
    return explicit;
  }
  if ((env.GITHUB_ACTIONS ?? "") === "true") return "github-actions";
  // Compared to the exact string rather than tested for presence: the variable
  // is documented as carrying "true" in a cloud session and never being true
  // locally, so a presence test would misread a shell that exports it empty.
  if ((env.CLAUDE_CODE_REMOTE ?? "") === "true") return "claude-web";
  if ((env.CODEX_SANDBOX ?? env.CODEX_HOME ?? "") !== "") return "codex-cloud";
  return "local";
}

/**
 * Reject a namespace that is not exactly one safe path segment.
 *
 * The namespace is joined onto a config root, so anything containing a
 * separator or a parent reference could redirect writes outside the intended
 * directory. Validating here means every caller inherits the guard.
 * @param {string} namespace Candidate namespace.
 * @returns {string} The namespace, unchanged, when valid.
 */
export function assertNamespace(namespace) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(namespace) || namespace === "..") {
    throw new Error(
      `secrets.namespace must be one safe path segment, got "${namespace}"`
    );
  }
  return namespace;
}

/**
 * Where a surface's materialized files live.
 * @param {string} namespace Validated namespace.
 * @param {Record<string, string|undefined>} [env] Environment to inspect.
 * @returns {{dir: string, valuesFile: string, notesFile: string}} Paths.
 */
export function materializedPaths(namespace, env = process.env) {
  const root = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  const dir = join(root, assertNamespace(namespace));
  return {
    dir,
    valuesFile: join(dir, "secrets.env"),
    notesFile: join(dir, "secret-notes.json"),
  };
}

/**
 * Read the `secrets` block from `.lisa.config.json`.
 *
 * A project with no block is a supported state, not an error: the `env`
 * provider means the environment *is* the provider. A credentials manager is
 * the preferred path, never a required one.
 * @param {string} [cwd] Directory to look in.
 * @returns {{provider: string, bootstrap: {sources: string[], key: string|null}, require: string[]|null, requiredFloor: readonly string[], rotating: string[], namespace: string, narrow: object, surface: string, routing: {tracker?: string, source?: string}, capabilities: object}} Resolved configuration with defaults applied.
 */
export function readConfig(cwd = process.cwd(), env = process.env) {
  const path = join(cwd, ".lisa.config.json");
  // No repository is a real, supported state — not just a missing file.
  //
  // A Claude Tag channel session runs as the organization with no user account,
  // and a repository "doesn't enter a session until a request names it". So a
  // session can legitimately have no checkout and therefore no config, while
  // still needing the credentials and profiles every other surface gets.
  //
  // The only values a config would supply here are the namespace and provider,
  // so they can come from the environment instead. Everything else keeps its
  // default, and an environment that sets neither still gets the old behaviour.
  if (!existsSync(path)) return withSurface(fromEnvironment(env));
  let root;
  try {
    root = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`.lisa.config.json is not readable: ${err.message}`);
  }
  const cfg = root.secrets;
  // Read outside the `secrets` block on purpose. The routing that implies a
  // credential is declared once, at the top level, and restating it under
  // `secrets` would be a second copy free to disagree with the one every other
  // skill dispatches on.
  const routing = { tracker: root.tracker, source: root.source };
  if (!cfg) return withSurface({ ...DEFAULTS, routing });
  const provider = cfg.provider ?? DEFAULTS.provider;
  const namespace = assertNamespace(cfg.namespace ?? DEFAULTS.namespace);
  return withSurface({
    provider,
    bootstrap: resolveBootstrap(cfg.bootstrap, provider, namespace),
    require: cfg.require ?? null,
    rotating: cfg.rotating ?? [],
    namespace,
    narrow: { ...DEFAULTS.narrow, ...(cfg.narrow ?? {}) },
    surface: cfg.surface ?? null,
    routing,
  });
}

/**
 * Fill in the bootstrap block a project did not spell out.
 *
 * Both defaults exist because a token stored on the machine was going unread.
 *
 * **The key** follows the same convention the repo-less path uses,
 * `<PROVIDER_VAR>_<namespace>`, so a machine provisioned once serves every
 * project of that tenant without each restating the name. A project that sets
 * one keeps it: a name that is not derivable is a legitimate choice, and
 * overriding it would point sessions at a variable nobody set.
 *
 * **The sources** gain `keychain` because `["env"]` alone meant a token in the
 * OS keychain was never consulted — so the machine setup appeared to work and
 * every project still failed until someone hand-edited its config. Env stays
 * first, so a CI runner injecting the bootstrap never reaches for a local store.
 * On a platform with no keychain the extra source reads as empty and costs
 * nothing.
 * @param {object|undefined} bootstrap The project's own block, if any.
 * @param {string} provider Resolved provider name.
 * @param {string} namespace Resolved namespace.
 * @returns {{sources: string[], key: string|null}} The resolved block.
 */
function resolveBootstrap(bootstrap, provider, namespace) {
  const given = bootstrap ?? {};
  return {
    sources: given.sources ?? ["env", "keychain"],
    key: given.key ?? bootstrapKeyFor(provider, namespace),
  };
}

/**
 * Build a configuration for a tenant the operator named outright.
 *
 * Deliberately ignores any `.lisa.config.json` in the working directory. The
 * flag is the more specific statement — someone who typed `--tenant=acme` means
 * acme, whichever repository they happen to be standing in — and silently
 * preferring the file would materialize a different tenant than the one on the
 * command line.
 *
 * Getting this wrong is not a cosmetic error. Every namespace is a directory
 * under `$XDG_CONFIG_HOME`, so resolving to the wrong one writes one tenant's
 * credentials where another tenant's sessions read, and on a machine serving
 * several the two would share a store.
 * @param {{tenant: string, provider?: string}} options Named identity.
 * @param {Record<string, string|undefined>} [env] Environment to inherit.
 * @returns {object} A resolved configuration.
 */
export function configForTenant({ tenant, provider }, env = process.env) {
  return withSurface(
    fromEnvironment({
      ...env,
      LISA_TENANT: tenant,
      ...(provider ? { LISA_PROVIDER: provider } : {}),
    })
  );
}

/**
 * Build a configuration from the environment, for sessions with no checkout.
 *
 * `LISA_SECRETS_NAMESPACE` is the one value with no safe default: it names the
 * directory secrets are written to and the tenant they belong to, so guessing
 * it would write one tenant's credentials under another's name. Absent, this
 * returns the ordinary defaults and the caller behaves exactly as before.
 *
 * The bootstrap key follows the namespace by convention
 * (`BWS_ACCESS_TOKEN_<namespace>`) so a channel environment needs one variable
 * set, not two.
 * @param {object} env The environment to read.
 * @returns {object} A configuration, defaulted where the environment is silent.
 */
function fromEnvironment(env) {
  // `LISA_TENANT` is the name to prefer, and the reason is not cosmetic.
  //
  // A Claude Tag session's safety classifier refuses a request that so much as
  // NAMES a secret-shaped variable — and it refuses the whole request, so one
  // such name poisons every check bundled with it. `LISA_SECRETS_NAMESPACE`
  // holds a tenant name, not a secret, but it reads like one and an operator
  // cannot ask about it, print it, or debug around it on that surface.
  //
  // The older name keeps working: it is configured in live environments, and
  // breaking those to improve a spelling would be a poor trade.
  const namespace = (
    env.LISA_TENANT ??
    env.LISA_SECRETS_NAMESPACE ??
    ""
  ).trim();
  if (!namespace) return DEFAULTS;

  const provider =
    (env.LISA_PROVIDER ?? env.LISA_SECRETS_PROVIDER ?? "").trim() ||
    "bitwarden";
  return {
    ...DEFAULTS,
    provider,
    namespace: assertNamespace(namespace),
    bootstrap: {
      ...DEFAULTS.bootstrap,
      // Derived from the provider resolved just above, not from Bitwarden's
      // name. Hardcoding it told a Doppler tenant to set BWS_ACCESS_TOKEN_<ns>,
      // which its CLI has never heard of — on the one surface that has no
      // config file to override the guess.
      // Same two defaults as a project config gets, for the same reasons —
      // see `resolveBootstrap`. Stated here too because this path never reads
      // a file, so it cannot inherit them.
      sources: ["env", "keychain"],
      key:
        env.LISA_BOOTSTRAP_KEY ??
        env.LISA_SECRETS_BOOTSTRAP_KEY ??
        bootstrapKeyFor(provider, namespace),
    },
  };
}

/**
 * Attach the resolved surface, its capabilities, and the required sets.
 *
 * `require` is flattened here rather than at each caller because this is the
 * one place that knows the surface, and a surface-scoped list cannot be read
 * without it.
 * @param {object} cfg Configuration without surface resolution.
 * @returns {object} The same configuration plus surface-derived fields.
 */
function withSurface(cfg) {
  const surface = detectSurface(cfg.surface);
  return {
    ...cfg,
    surface,
    capabilities: SURFACES[surface],
    require: resolveRequire(cfg.require, surface),
    requiredFloor: routingFloor(cfg.routing ?? {}),
  };
}

/**
 * Flatten a `require` declaration for one surface.
 *
 * Two shapes are accepted. An array is every surface — the original meaning,
 * and still correct for the many projects whose credentials do not vary. An
 * object opts into scoping: `all` applies everywhere and a key matching the
 * surface adds to it.
 *
 * Scoping exists because the required set genuinely differs by where the agent
 * runs. `CLAUDE_ROUTINE_TOKEN` is mandatory on `claude-web` and meaningless on
 * a laptop; asserting one flat list everywhere would fail a developer's session
 * over a credential only a cloud surface uses, and the reliable response to a
 * check that fails for the wrong reason is to stop believing it.
 *
 * Returns `null` — not `[]` — when nothing is declared, because the two mean
 * different things downstream: `null` leaves resolution un-narrowed, while an
 * empty array would declare that the project needs no secrets and make
 * `assertDeclared` reject every name.
 * @param {string[]|Record<string, string[]>|null|undefined} raw Declaration.
 * @param {string} surface Resolved surface key.
 * @returns {string[]|null} Names required on this surface, or null.
 */
function resolveRequire(raw, surface) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "object") return null;
  const names = [...(raw.all ?? []), ...(raw[surface] ?? [])];
  return names.length ? [...new Set(names)] : null;
}
