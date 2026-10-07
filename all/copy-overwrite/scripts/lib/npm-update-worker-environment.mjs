// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Closed guest environment carries only fixed runtime and narrowly scoped workload data. @module npm-updater */
import { required } from "./npm-update-contract.mjs";

const RUBY_INSTALL = "ruby-install";
const PROVIDER_TRANSPORT = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "CURL_CA_BUNDLE",
  "SSLKEYLOGFILE",
  "GH_DEBUG",
  "GH_HTTP_UNIX_SOCKET",
  "GH_CONFIG_DIR",
  "GH_FORCE_TTY",
  "GIT_SSL_CAINFO",
  "GIT_PROXY_COMMAND",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
]);

/** Both credentialed and token-free callers reject the same native transport overrides. */
export function isProviderTransport(name) {
  return PROVIDER_TRANSPORT.has(name) || name.startsWith("DYLD_");
}

const ENVIRONMENT = new Set([
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "TMP",
  "TEMP",
  "NODE_VERSION",
  "NPM_CONFIG_USERCONFIG",
  "NPM_CONFIG_GLOBALCONFIG",
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_REGISTRY",
  "NPM_CONFIG_IGNORE_SCRIPTS",
  "NPM_CONFIG_AUDIT",
  "NPM_CONFIG_FUND",
  "NPM_CONFIG_UPDATE_NOTIFIER",
  "GIT_TERMINAL_PROMPT",
  "RAILS_ENV",
  "DATABASE_USER",
  "DATABASE_PASSWORD",
  "DATABASE_NAME",
  "DATABASE_PORT",
  "PRIMARY_DB_HOST",
  "DATABASE_REPLICA_HOST",
  "HOSTNAME",
  "RUBY_VERSION",
  "RUBY_DOWNLOAD_URL",
  "RUBY_DOWNLOAD_SHA256",
  "GEM_HOME",
  "BUNDLE_SILENCE_ROOT_WARNING",
  "BUNDLE_APP_CONFIG",
  "BUNDLE_PATH",
  "BUNDLE_FROZEN",
]);

/** Installer identity is confined to an isolated dependency-only namespace. */
export function isInstallerRole(role) {
  return role === "install" || role === RUBY_INSTALL;
}

/** Candidate inspection rejects provider credentials and controller identity channels. */
export function inspectedEnvironment(values) {
  required(
    Array.isArray(values) && values.length <= ENVIRONMENT.size,
    "worker environment is unbounded"
  );
  const names = values.map(value => {
    required(
      typeof value === "string" && value.includes("="),
      "invalid worker environment value"
    );
    return value.slice(0, value.indexOf("="));
  });
  required(
    names.every(name => ENVIRONMENT.has(name)) &&
      new Set(names).size === names.length,
    "worker contains ambient or duplicated authority environment"
  );
}

/** Sealed and installer Ruby projections use the same fixed frozen dependency path. */
export function assertRubyEnvironment(environment, boundary) {
  const ruby =
    boundary.role === RUBY_INSTALL ||
    boundary.mounts?.some(
      mount =>
        mount.source === `${boundary.root}/ruby-dependencies` &&
        mount.target === `${boundary.workspace}/vendor/bundle` &&
        mount.readOnly === true
    );
  if (ruby)
    required(
      environment.BUNDLE_PATH === `${boundary.workspace}/vendor/bundle` &&
        environment.BUNDLE_FROZEN === "true" &&
        environment.BUNDLE_APP_CONFIG === "/home/candidate/bundle",
      "Ruby dependency environment requires its fixed path and frozen config"
    );
}

/** Private runtime settings never inherit Actions, controller, issuer or registry channels. */
export function workerEnvironment(source, boundary) {
  const value = {
    PATH: "/opt/node/bin:/usr/local/bin:/usr/bin:/bin",
    HOME: "/home/candidate",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "UTC",
    TMPDIR: "/tmp",
    NPM_CONFIG_USERCONFIG: "/home/candidate/npmrc",
    NPM_CONFIG_GLOBALCONFIG: "/home/candidate/global-npmrc",
    NPM_CONFIG_CACHE: "/home/candidate/npm-cache",
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    GIT_TERMINAL_PROMPT: "0",
  };
  if (!isInstallerRole(boundary?.role)) {
    for (const name of [
      "RAILS_ENV",
      "DATABASE_USER",
      "DATABASE_PASSWORD",
      "DATABASE_NAME",
      "DATABASE_PORT",
      "PRIMARY_DB_HOST",
      "DATABASE_REPLICA_HOST",
    ])
      if (typeof source?.[name] === "string") value[name] = source[name];
  }
  if (
    boundary?.role === RUBY_INSTALL ||
    boundary?.mounts?.some(
      mount =>
        mount.source === `${boundary.root}/ruby-dependencies` &&
        mount.target === `${boundary.workspace}/vendor/bundle` &&
        mount.readOnly === true
    )
  ) {
    value.BUNDLE_PATH = `${boundary.workspace}/vendor/bundle`;
    value.BUNDLE_FROZEN = "true";
    value.BUNDLE_APP_CONFIG = "/home/candidate/bundle";
  }
  return value;
}
