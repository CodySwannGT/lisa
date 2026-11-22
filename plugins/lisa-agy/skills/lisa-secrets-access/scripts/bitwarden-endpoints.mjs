/** Resolve the same server configuration as the Bitwarden CLI read path. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readBitwardenProfiles } from "./bitwarden-profiles.mjs";

const DEFAULT_ENDPOINTS = {
  api: "https://api.bitwarden.com",
  identity: "https://identity.bitwarden.com",
};

function serverUrl(value) {
  if (typeof value !== "string")
    throw new Error("Bitwarden endpoint is missing");
  const url = new URL(value);
  if (
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        /^http:\/\/(?:127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/iu.test(value))
    ) ||
    /[\s\\?#]/u.test(value) ||
    url.username ||
    url.password
  ) {
    throw new Error("invalid Bitwarden endpoint");
  }
  return url.href.replace(/\/+$/u, "");
}

export function bitwardenEndpoints(accountId, env = process.env) {
  if (env.BWS_SERVER_URL !== undefined) {
    const base = serverUrl(env.BWS_SERVER_URL);
    return { api: base + "/api", identity: base + "/identity" };
  }

  const customFile = env.BWS_CONFIG_FILE;
  const namedProfile = env.BWS_PROFILE;
  let config;
  try {
    config = readFileSync(
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
  const profiles = readBitwardenProfiles(config, env);
  const profile = profiles.get(namedProfile ?? accountId);
  const selected =
    namedProfile === undefined ? (profile ?? profiles.get("default")) : profile;
  if (selected === undefined) {
    if (namedProfile !== undefined)
      throw new Error("Bitwarden profile is missing");
    return DEFAULT_ENDPOINTS;
  }
  const endpoint = (override, suffix) =>
    override === undefined
      ? serverUrl(selected.server_base) + suffix
      : serverUrl(override);
  return {
    api: endpoint(selected.server_api, "/api"),
    identity: endpoint(selected.server_identity, "/identity"),
  };
}
