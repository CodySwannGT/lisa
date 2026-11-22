/** Resolve the same server configuration as the Bitwarden CLI read path. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_ENDPOINTS = {
  api: "https://api.bitwarden.com",
  identity: "https://identity.bitwarden.com",
};

function serverUrl(value) {
  if (typeof value !== "string")
    throw new Error("Bitwarden endpoint is missing");
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("invalid Bitwarden endpoint");
  }
  return url.href.replace(/\/+$/u, "");
}

function loadProfiles(path) {
  const config = readFileSync(path, "utf8");
  const local = createRequire(import.meta.url);
  let parse;
  try {
    ({ parse } = local("smol-toml"));
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    // A standalone marketplace copy can run outside the host's npm tree.
    // Resolve the existing TOML dependency of the project's installed Lisa.
    const fromHost = createRequire(join(process.cwd(), "package.json"));
    ({ parse } = createRequire(fromHost.resolve("@codyswann/lisa"))(
      "smol-toml"
    ));
  }
  const { profiles } = parse(config);
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    throw new Error("invalid Bitwarden profile configuration");
  }
  return profiles;
}

export function bitwardenEndpoints(accountId, env = process.env) {
  if (env.BWS_SERVER_URL !== undefined) {
    const base = serverUrl(env.BWS_SERVER_URL);
    return { api: base + "/api", identity: base + "/identity" };
  }

  const customFile = env.BWS_CONFIG_FILE;
  const namedProfile = env.BWS_PROFILE;
  let profiles;
  try {
    profiles = loadProfiles(
      customFile ?? join(homedir(), ".config", "bws", "config")
    );
  } catch (error) {
    if (
      error.code === "ENOENT" &&
      customFile === undefined &&
      namedProfile === undefined
    ) {
      return DEFAULT_ENDPOINTS;
    }
    throw error;
  }
  const profile = Object.hasOwn(profiles, namedProfile ?? accountId)
    ? profiles[namedProfile ?? accountId]
    : undefined;
  const selected =
    namedProfile === undefined ? (profile ?? profiles.default) : profile;
  if (selected === undefined) {
    if (namedProfile !== undefined)
      throw new Error("Bitwarden profile is missing");
    return DEFAULT_ENDPOINTS;
  }
  const base =
    selected.server_base === undefined
      ? undefined
      : serverUrl(selected.server_base);
  return {
    api: serverUrl(selected.server_api ?? (base && base + "/api")),
    identity: serverUrl(
      selected.server_identity ?? (base && base + "/identity")
    ),
  };
}
