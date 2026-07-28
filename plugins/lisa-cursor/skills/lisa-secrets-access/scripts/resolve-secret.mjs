#!/usr/bin/env node
/**
 * Resolve a secret through the configured provider.
 *
 * The executable half of `lisa-secrets-access`. It exists as a CLI rather than
 * a library because the callers are polyglot — Python scripts, shell, and
 * TypeScript all need the same answer, and a subprocess is the only interface
 * all three share without duplicating the logic three times.
 *
 * Resolution order is environment, then provider. The environment comes first
 * so a CI run — where secrets are injected by the pipeline — never reaches for
 * a provider or a local store at all.
 *
 * Values are written to stdout with no trailing newline and nothing else, so
 * `$(resolve-secret.mjs get NAME)` is safe. Diagnostics go to stderr.
 *
 * Usage:
 *   resolve-secret.mjs get NAME
 *   resolve-secret.mjs list
 *   resolve-secret.mjs describe NAME
 *   resolve-secret.mjs verify
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Config defaults when `.lisa.config.json` carries no `secrets` block. */
const DEFAULTS = {
  provider: "env",
  bootstrap: { sources: ["env"], key: null },
  require: null,
};

/**
 * Read the `secrets` block from `.lisa.config.json`.
 * @param {string} cwd Directory to look in.
 * @returns {{provider: string, bootstrap: {sources: string[], key: string|null}, require: string[]|null}}
 */
export function readConfig(cwd = process.cwd()) {
  const path = join(cwd, ".lisa.config.json");
  if (!existsSync(path)) return DEFAULTS;
  try {
    const cfg = JSON.parse(readFileSync(path, "utf8")).secrets;
    if (!cfg) return DEFAULTS;
    return {
      provider: cfg.provider ?? DEFAULTS.provider,
      bootstrap: { ...DEFAULTS.bootstrap, ...(cfg.bootstrap ?? {}) },
      require: cfg.require ?? null,
    };
  } catch (err) {
    throw new Error(`.lisa.config.json is not readable: ${err.message}`);
  }
}

/**
 * Obtain the one credential that unlocks the provider.
 *
 * Walks `sources` in order. This is the only credential permitted in an OS
 * keychain — it is a bootstrap, not a cached copy of anything.
 * @param {{sources: string[], key: string|null}} bootstrap Bootstrap config.
 * @returns {string|null} The token, or null when the provider needs none.
 */
function bootstrapToken(bootstrap) {
  if (!bootstrap.key) return null;
  for (const source of bootstrap.sources) {
    if (source === "env") {
      const v = (process.env[bootstrap.key] ?? "").trim();
      if (v) return v;
    }
    if (source === "keychain" && process.platform === "darwin") {
      try {
        const v = execFileSync(
          "security",
          [
            "find-generic-password",
            "-s",
            bootstrap.key,
            "-a",
            process.env.USER ?? "",
            "-w",
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
        ).trim();
        if (v) return v;
      } catch {
        /* not present in the keychain; try the next source */
      }
    }
  }
  throw new Error(
    `${bootstrap.key} not found in: ${bootstrap.sources.join(", ")}.\n` +
      `It is the bootstrap credential — without it no other secret can be read.`
  );
}

/**
 * Fetch every secret the provider grants, keyed by name.
 *
 * Deliberately fetches all rather than one: the provider already scopes what
 * this caller may see, so the set it returns *is* the permitted set, and
 * re-stating that as a list in config would duplicate a boundary the provider
 * already enforces.
 * @param {ReturnType<typeof readConfig>} cfg Resolved config.
 * @returns {Map<string, {value: string, note: string}>} Secrets by name.
 */
function fetchAll(cfg) {
  const out = new Map();
  const token = bootstrapToken(cfg.bootstrap);
  const env = { ...process.env };
  if (cfg.bootstrap.key && token) env[cfg.bootstrap.key] = token;

  switch (cfg.provider) {
    case "env":
      for (const [k, v] of Object.entries(process.env)) {
        if (/^[A-Z][A-Z0-9_]*$/.test(k))
          out.set(k, { value: v ?? "", note: "" });
      }
      return out;

    case "bitwarden": {
      const raw = execFileSync("bws", ["secret", "list", "--output", "json"], {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      for (const s of JSON.parse(raw || "[]")) {
        out.set(s.key, { value: s.value, note: s.note ?? "" });
      }
      return out;
    }

    case "doppler": {
      const raw = execFileSync(
        "doppler",
        ["secrets", "download", "--no-file", "--format", "json"],
        {
          encoding: "utf8",
          env,
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      for (const [k, v] of Object.entries(JSON.parse(raw || "{}"))) {
        out.set(k, { value: String(v), note: "" });
      }
      return out;
    }

    default:
      throw new Error(
        `provider "${cfg.provider}" has no bulk read implemented yet.\n` +
          `Add one in resolve-secret.mjs — see the dispatch table in SKILL.md.`
      );
  }
}

/**
 * Resolve one secret: environment first, then the provider.
 * @param {string} name Environment-variable-style key.
 * @param {ReturnType<typeof readConfig>} [cfg] Resolved config.
 * @returns {string} The secret value.
 */
export function get(name, cfg = readConfig()) {
  const fromEnv = (process.env[name] ?? "").trim();
  if (fromEnv) return fromEnv;

  // A `require` list is an assertion, not just a filter: naming a secret
  // declares that this project needs it, so asking for one outside the list is
  // a configuration error rather than a lookup miss.
  if (cfg.require && !cfg.require.includes(name)) {
    throw new Error(
      `${name} is not declared in secrets.require.\n` +
        `Declared: ${cfg.require.join(", ") || "(none)"}`
    );
  }

  const all = fetchAll(cfg);
  const hit = all.get(name);
  if (!hit || !hit.value) {
    throw new Error(
      `${name} is not available to this account.\n` +
        `Visible: ${[...all.keys()].sort().join(", ") || "(none)"}\n` +
        `A secret's key must be the exact environment variable name.`
    );
  }
  return hit.value;
}

function main() {
  const [op, name] = process.argv.slice(2);
  const cfg = readConfig();

  if (op === "get") {
    if (!name) throw new Error("usage: resolve-secret.mjs get NAME");
    process.stdout.write(get(name, cfg));
    return;
  }
  if (op === "list") {
    // Names only. This command must never be able to leak a value.
    console.log([...fetchAll(cfg).keys()].sort().join("\n"));
    return;
  }
  if (op === "describe") {
    if (!name) throw new Error("usage: resolve-secret.mjs describe NAME");
    const hit = fetchAll(cfg).get(name);
    if (hit) {
      console.log(
        hit.note || `(no note — purpose inferred from the name: ${name})`
      );
      return;
    }
    // Environment-only is a legitimate state, not an error: CI injects secrets
    // that never appear in the provider listing. Say so rather than claiming
    // the secret does not exist, and never print the value.
    if ((process.env[name] ?? "").trim()) {
      console.log(
        `(set in the environment; no provider entry, so no note is available)`
      );
      return;
    }
    throw new Error(`${name} not found in the environment or the provider`);
  }
  if (op === "verify") {
    const all = fetchAll(cfg);
    const names = cfg.require ?? [...all.keys()];
    let bad = 0;
    for (const n of names) {
      // Mirror get()'s environment-first order. Checking only the provider
      // reports MISSING for every secret in CI, where the pipeline injects
      // them as environment variables — a false negative precisely where
      // verification matters most.
      const fromEnv = Boolean((process.env[n] ?? "").trim());
      const entry = all.get(n);
      const ok = fromEnv || Boolean(entry?.value);
      const named = /^[A-Z][A-Z0-9_]*$/.test(n);
      const noted = Boolean(entry?.note);
      if (!ok || !named) bad += 1;
      const source = fromEnv
        ? "env     "
        : entry?.value
          ? "provider"
          : "        ";
      console.log(
        `  ${n.padEnd(30)} ${ok ? "resolves" : "MISSING "} ${source}  ` +
          `${named ? "name ok" : "NAME NOT UPPER_SNAKE"}  ${noted ? "noted" : "no note"}`
      );
    }
    if (bad) throw new Error(`${bad} secret(s) failed verification`);
    return;
  }
  throw new Error("usage: resolve-secret.mjs get|list|describe|verify [NAME]");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
