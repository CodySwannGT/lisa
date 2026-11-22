/** Loopback write service for the session manager's Bitwarden migration test. */
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { parentPort, workerData } from "node:worker_threads";

import {
  decrypt,
  deriveAccessKey,
  encrypt,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/bitwarden-encryption.mjs";

const {
  vault,
  requests,
  account,
  credential,
  seed,
  projectId,
  readbackStatus,
} = workerData;
const organizationId = "27e93d92-6fd3-4f74-9aa3-7a27728c99e1";
const id = "a91b5044-64cb-471a-8784-4c1d0d008483";
const claims = Buffer.from(JSON.stringify({ organization: organizationId }));
const token = `header.${claims.toString("base64url")}.signature`;
const key = Buffer.alloc(64, 9);
const loginPayload = encrypt(
  deriveAccessKey(Buffer.from(seed, "base64")),
  JSON.stringify({ encryptionKey: key.toString("base64") })
);
const loginPath = "/identity/connect/token";
const createPath = `/api/organizations/${organizationId}/secrets`;
const readPath = `/api/secrets/${id}`;
const stored = `${vault}.encrypted.json`;

/**
 * Read the complete body from a request on the loopback server.
 * @param {import("node:http").IncomingMessage} request - Incoming request
 * @returns {Promise<string>} The UTF-8 body
 */
async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Finish a request with its JSON response.
 * @param {import("node:http").ServerResponse} response - Outgoing response
 * @param {number} status - HTTP status
 * @param {object} body - Fixture response data
 */
function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  try {
    const { method, url } = request;
    appendFileSync(requests, `${JSON.stringify({ method, url })}\n`);
    if (method === "POST" && url === loginPath) {
      const login = new URLSearchParams(await readBody(request));
      if (
        login.get("client_id") !== account ||
        login.get("client_secret") !== credential ||
        login.get("scope") !== "api.secrets" ||
        login.get("grant_type") !== "client_credentials"
      ) {
        return send(response, 401, {});
      }
      return send(response, 200, {
        access_token: token,
        encrypted_payload: loginPayload,
      });
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      return send(response, 401, {});
    }
    if (method === "POST" && url === createPath && !existsSync(stored)) {
      const body = JSON.parse(await readBody(request));
      if (body.projectIds?.length !== 1 || body.projectIds[0] !== projectId) {
        return send(response, 400, {});
      }
      const row = { id, projectId };
      for (const field of ["key", "note", "value"]) {
        row[field] = decrypt(key, body[field]);
      }
      writeFileSync(vault, JSON.stringify([row]));
      const record = {
        id,
        organizationId,
        projects: [{ id: projectId }],
        key: body.key,
        note: body.note,
        value: body.value,
      };
      writeFileSync(stored, JSON.stringify(record));
      return send(response, 200, record);
    }
    if (method === "GET" && url === readPath && existsSync(stored)) {
      if (readbackStatus !== 200) return send(response, readbackStatus, {});
      return send(response, 200, JSON.parse(readFileSync(stored, "utf8")));
    }
    return send(response, 404, {});
  } catch {
    return send(response, 500, {});
  }
});

server.listen(0, "127.0.0.1", () =>
  parentPort.postMessage(server.address().port)
);
