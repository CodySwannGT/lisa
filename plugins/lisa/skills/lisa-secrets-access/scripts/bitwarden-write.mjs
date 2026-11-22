/**
 * Bitwarden Secrets Manager REST write protocol.
 * Plaintext credentials and values enter the process exclusively over stdin.
 */
import { readFileSync } from "node:fs";
import {
  decrypt,
  deriveAccessKey,
  encrypt,
  fromBase64,
} from "./bitwarden-encryption.mjs";
import { bitwardenEndpoints } from "./bitwarden-endpoints.mjs";

const idPattern = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu;
const accessPattern = /^0\.([a-f\d-]{36})\.([^:.\s]+):([A-Za-z\d+/]+={0,2})$/iu;

function requireId(value) {
  if (typeof value !== "string" || !idPattern.test(value))
    throw new Error("invalid identifier");
  return value.toLowerCase();
}

async function jsonRequest(url, options) {
  const response = await fetch(url, { ...options, redirect: "error" });
  if (response.status === 429) throw new RateLimitError();
  if (!response.ok) throw new Error("request refused");
  return response.json();
}

class RateLimitError extends Error {}

async function authenticate({ identity }, { id, credential, seed }) {
  const tokenKey = deriveAccessKey(fromBase64(seed, 16));
  const auth = await jsonRequest(identity + "/connect/token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      scope: "api.secrets",
      client_id: requireId(id),
      client_secret: credential,
      grant_type: "client_credentials",
    }),
  });
  const token = auth.access_token;
  if (typeof token !== "string" || !/^[\w-]+\.[\w-]+\.[\w-]+$/u.test(token))
    throw new Error("invalid access response");
  // Use routing claims only from the access token returned by the authenticated HTTPS endpoint.
  // The service checks the signature and granted rights on every subsequent request.
  const claims = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString("utf8")
  );
  const organization = requireId(claims.organization);
  const payload = JSON.parse(decrypt(tokenKey, auth.encrypted_payload));
  return { organization, token, key: fromBase64(payload.encryptionKey, 64) };
}

function projectIds(secret) {
  if (secret.projects === null || secret.projects === undefined) return [];
  if (!Array.isArray(secret.projects)) throw new Error("invalid projects");
  return secret.projects.map(project => requireId(project.id)).sort();
}

function validSecret(secret, auth, id) {
  if (
    requireId(secret.id) !== id ||
    requireId(secret.organizationId) !== auth.organization ||
    typeof secret.key !== "string" ||
    (secret.note != null && typeof secret.note !== "string")
  ) {
    throw new Error("secret identity mismatch");
  }
  return secret;
}

function requestOf(raw) {
  const input = JSON.parse(raw);
  if (
    typeof input?.value !== "string" ||
    typeof input?.accessToken !== "string"
  )
    throw new Error("invalid request");
  if (input.operation === "replace") {
    input.id = requireId(input.id);
  } else if (
    input.operation === "create" &&
    typeof input.name === "string" &&
    /^[A-Za-z_][A-Za-z\d_]*$/u.test(input.name) &&
    (input.note === undefined || typeof input.note === "string")
  ) {
    input.projectId = requireId(input.projectId);
  } else {
    throw new Error("invalid operation");
  }
  const parsed = accessPattern.exec(input.accessToken);
  if (!parsed) throw new Error("invalid access token");
  const [, id, credential, seed] = parsed;
  const { operation, name, value, note, projectId } = input;
  return {
    operation,
    name,
    value,
    note,
    projectId,
    id: input.id,
    account: { id: requireId(id), credential, seed },
  };
}

async function write(endpoints, request) {
  const auth = await authenticate(endpoints, request.account);
  const http = (method, path, payload) =>
    jsonRequest(endpoints.api + path, {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: "Bearer " + auth.token,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  const value = encrypt(auth.key, request.value);
  let id, expectedKey, expectedNote, expectedProjects;
  if (request.operation === "create") {
    expectedKey = encrypt(auth.key, request.name);
    expectedNote = encrypt(auth.key, request.note ?? "");
    expectedProjects = [request.projectId];
    const created = await http(
      "POST",
      "/organizations/" + auth.organization + "/secrets",
      {
        key: expectedKey,
        note: expectedNote,
        value,
        projectIds: expectedProjects,
      }
    );
    id = requireId(created.id);
    validSecret(created, auth, id);
  } else {
    id = request.id;
    const existing = validSecret(await http("GET", "/secrets/" + id), auth, id);
    expectedKey = existing.key;
    expectedNote = existing.note ?? encrypt(auth.key, "");
    expectedProjects = projectIds(existing);
    await http("PUT", "/secrets/" + id, {
      key: expectedKey,
      note: expectedNote,
      value,
      projectIds: expectedProjects,
    });
  }
  const observed = validSecret(await http("GET", "/secrets/" + id), auth, id);
  if (
    decrypt(auth.key, observed.value) !== request.value ||
    observed.key !== expectedKey ||
    observed.note !== expectedNote ||
    JSON.stringify(projectIds(observed)) !== JSON.stringify(expectedProjects)
  ) {
    process.exitCode = 84;
    return;
  }
}

try {
  const request = requestOf(readFileSync(0, "utf8"));
  let endpoints;
  try {
    endpoints = bitwardenEndpoints(request.account.id);
  } catch {
    process.exitCode = 82;
  }
  if (endpoints) await write(endpoints, request);
} catch (error) {
  process.exitCode = error instanceof RateLimitError ? 85 : 83;
}
