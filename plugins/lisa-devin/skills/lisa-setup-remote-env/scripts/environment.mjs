#!/usr/bin/env node
/**
 * Configure one surface for one tenant.
 *
 * One verb, one axis — *which surface* — and the only difference between them
 * is whether Lisa can execute there or has to hand an operator text to paste.
 *
 *     environment local        runs it here
 *     environment container    emits an image definition and a run command
 *     environment claude-web   emits, because the dialog has no API
 *     environment codex-cloud  emits, same reason
 *
 * This replaces `remote-env --emit=<surface>`, whose name described the
 * machinery rather than the task: from a laptop, `remote-env` reads as
 * "prepare the remote environment I am currently in", which is the opposite of
 * what an operator configuring a cloud environment is doing. The old spelling
 * still works so nothing in flight breaks.
 *
 * `workstation` remains a separate command and a separate concern: it answers
 * "what binaries does this machine have", with no tenant and no credentials. So
 * **rotating a token is `environment local` again**, not re-running an
 * installer that wants to reinstall six coding agents.
 * @module environment
 */

import { pathToFileURL } from "node:url";

/** Surfaces this command can configure, and how each is delivered. */
export const TARGETS = {
  local: { mode: "run", label: "this machine" },
  container: { mode: "emit", label: "a container image you build" },
  "claude-web": { mode: "emit", label: "a Claude cloud environment" },
  "codex-cloud": { mode: "emit", label: "a Codex Cloud environment" },
};

/**
 * Resolve the surface name an operator asked for.
 *
 * An unknown name is an error rather than a default, because defaulting would
 * configure something other than what they typed — and on this command the
 * difference between surfaces is where a credential ends up.
 * @param {string|undefined} name Requested surface.
 * @returns {string} A key of {@link TARGETS}.
 */
export function assertTarget(name) {
  if (!name || !TARGETS[name]) {
    throw new Error(
      `unknown environment "${name ?? ""}".\n` +
        `Known: ${Object.keys(TARGETS).join(", ")}`
    );
  }
  return name;
}

/**
 * Prepare THIS machine: store the bootstrap, then materialize.
 *
 * The prompt is skipped rather than blocked when nothing can answer it, and
 * skipped rather than repeated when the machine already holds a bootstrap —
 * `environment local` is also how an operator re-materializes after rotating a
 * secret in the vault, and demanding the token again every time would make the
 * common case the tedious one. `--rotate` is how you say you mean to replace it.
 * @param {object} options Resolved tenant, provider and flags.
 * @param {object} [deps] Injected seams, for tests.
 * @returns {Promise<string[]>} Lines to report.
 */
export async function configureLocal(options, deps = {}) {
  const { tenant, provider, bootstrapKey: key, rotate = false } = options;
  const lines = [];

  // A tenant is required here, unlike the emit paths, because this one WRITES.
  // Without it the config falls back to the default namespace and materializes
  // one tenant's credentials into another's directory — and on a machine
  // serving several, the two would then share a store.
  if (!tenant) {
    throw new Error(
      "environment local needs --tenant=<name>.\n" +
        "It writes credentials into a per-tenant directory, so guessing the " +
        "name would put one tenant's secrets where another's sessions read."
    );
  }

  const wired = deps.prompt
    ? deps
    : { ...(await localDeps({ tenant, provider })), ...deps };
  const { canPrompt, promptSecret } = wired.prompt;
  const { storeBootstrap, hasBootstrap } = wired.store;
  const materialize = wired.materialize;

  if (!key) {
    lines.push(
      `${provider} has no environment-variable bootstrap, so there is nothing`,
      `to store. Authenticate it the way its own CLI expects.`
    );
  } else if (hasBootstrap(key) && !rotate) {
    lines.push(`${key} is already stored; pass --rotate to replace it.`);
  } else if (!canPrompt()) {
    // Not fatal. A non-interactive caller can legitimately have supplied the
    // bootstrap through the environment, and refusing would break that.
    lines.push(
      `No terminal to prompt on, so ${key} was not stored.`,
      `Set it in the environment, or re-run where a human can type.`
    );
  } else {
    const value = promptSecret(`Paste the access token for ${tenant}: `);
    if (!value) {
      lines.push(`Nothing entered, so ${key} was not stored.`);
    } else {
      const { where } = storeBootstrap(key, value);
      lines.push(`Stored ${key} in ${where}.`);
    }
  }

  const result = await materialize();
  lines.push(...result);
  return lines;
}

/**
 * Run the command.
 * @param {string[]} argv Arguments after the command name.
 * @param {object} [deps] Injected seams, for tests.
 * @returns {Promise<number>} Exit code.
 */
export async function run(argv, deps = {}) {
  const out = deps.log ?? console.log;
  const err = deps.error ?? console.error;

  try {
    const target = assertTarget(argv.find(a => !a.startsWith("-")));
    const resolve = deps.resolveTarget ?? (await defaultResolver());
    const identity = await resolve(argv);

    if (TARGETS[target].mode === "run") {
      const lines = await (deps.configureLocal ?? configureLocal)(
        { ...identity, rotate: argv.includes("--rotate") },
        deps
      );
      out(lines.join("\n"));
      return 0;
    }

    out((deps.emit ?? (await defaultEmitter()))(target, identity));
    return 0;
  } catch (error) {
    err(String(error.message));
    return 1;
  }
}

// Executed directly by the CLI, imported by tests. Without this the module
// exported a `run` nobody called and the command printed nothing at all.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  });
}

/**
 * Wire the local path to the real prompt, store and materializer.
 *
 * Loaded lazily so the emit paths — which need none of it — do not pay for it,
 * and so tests can substitute the lot without touching a keychain or a vault.
 *
 * `materialize` is called with `requested: true`: the operator typed the
 * command whose purpose is to put credentials on this machine, which is a
 * different question from whether an automated flow may write here. The
 * capability guard still refuses the automated case.
 * @returns {Promise<object>} Default dependencies for `configureLocal`.
 */
async function localDeps(identity) {
  const at = name =>
    new URL(`../../lisa-secrets-access/scripts/${name}`, import.meta.url).href;
  const prompt = await import(at("prompt-secret.mjs"));
  const store = await import(at("bootstrap-store.mjs"));
  const secrets = await import(at("materialize-secrets.mjs"));
  const surfaces = await import(at("surfaces.mjs"));

  return {
    prompt,
    store,
    materialize: () => {
      // The NAMED tenant, not whatever config the working directory holds.
      // Reading the directory materialized the default namespace instead of the
      // one on the command line — observed writing 49 secrets of the wrong
      // tenant into the wrong directory.
      const { count, derived, dir, profiles } = secrets.materialize(
        surfaces.configForTenant(identity),
        { requested: true }
      );
      return [
        `Materialized ${count} secret(s) into ${dir}.`,
        ...(derived ? [`${derived} variable(s) derived from the bundle.`] : []),
        ...(profiles?.length
          ? [`AWS profiles installed: ${profiles.join(", ")}`]
          : []),
      ];
    },
  };
}

/**
 * Load the identity resolver from the sibling runner.
 * @returns {Promise<Function>} The resolver.
 */
async function defaultResolver() {
  // Already a URL — passing it through pathToFileURL again throws.
  const mod = await import(
    new URL("./setup-remote-env.mjs", import.meta.url).href
  );
  return argv => mod.resolveEmitTarget(argv);
}

/**
 * Load the emitter from the sibling runner.
 * @returns {Promise<Function>} The emitter.
 */
async function defaultEmitter() {
  // Already a URL — passing it through pathToFileURL again throws.
  const mod = await import(
    new URL("./setup-remote-env.mjs", import.meta.url).href
  );
  return (target, identity) => mod.emitFor(target, identity);
}
