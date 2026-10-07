// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** A disposable CI gate exposes only a fixed read capability; publisher credentials never enter this job. */
import { createServer, createConnection } from "node:net";
import { chmodSync, lstatSync, realpathSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { required, keys } from "./npm-update-contract.mjs";
import { createGhDispatcher } from "./npm-update-gh-dispatch.mjs";

export const HOOK_READ_SLOTS = [
  "commit-prepare",
  "commit-work-item",
  "commit-provenance",
  "audit-work-item",
  "audit-provenance",
  "destination-work-item",
  "destination-provenance",
];

/** Slots separate actual hook reads; they are bounded state labels, not claimed caller authentication. */
function readScopes(profile, token) {
  required(
    profile.subject.phase === "hook-read",
    "hook broker cannot carry writer authority"
  );
  return new Map(
    HOOK_READ_SLOTS.map(slot => [slot, createGhDispatcher(profile, token)])
  );
}

function nativeResponse(result) {
  return {
    status: result.status,
    signal: result.signal,
    stdout: Buffer.from(result.stdout ?? "").toString("base64"),
    stderr: Buffer.from(result.stderr ?? "").toString("base64"),
    error: result.error
      ? { code: result.error.code ?? null, name: result.error.name }
      : null,
  };
}

/** Node normally unlinks its listener on close; an existing pathname still requires the original inode. */
function removeOwnedSocket(path, identity) {
  try {
    const current = lstatSync(path);
    required(
      current.dev === identity.dev &&
        current.ino === identity.ino &&
        current.isSocket(),
      "hook read cleanup ownership changed"
    );
    unlinkSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

/** No request can supply a native path, token, environment or new provider subject. */
function dispatchRead(scopes, request, cwd) {
  keys(request, ["slot", "args", "options"]);
  const execute = scopes.get(request.slot);
  required(execute, "unknown hook read slot");
  keys(request.options, ["encoding", "timeout", "maxBuffer", "killSignal"]);
  return nativeResponse(
    execute(
      "spawnSync",
      "gh",
      request.args,
      { ...request.options, cwd, env: {} },
      spawnSync
    )
  );
}

/** Each connection has a finite byte budget and consumes the shared phase request bound. */
function readServer(profile, scopes) {
  const connections = new Set();
  const state = { count: 0, closing: false };
  const server = createServer(socket => {
    if (state.closing || connections.size >= 32) {
      socket.destroy();
      return;
    }
    connections.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => connections.delete(socket));
    const chunks = [];
    let bytes = 0;
    socket.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > 262_144) socket.destroy();
      else chunks.push(chunk);
    });
    socket.on("end", () => {
      try {
        required(
          !state.closing &&
            Date.now() < profile.deadline &&
            ++state.count <= 1024,
          "hook read phase exhausted"
        );
        const text = new TextDecoder("utf8", { fatal: true }).decode(
          Buffer.concat(chunks)
        );
        const request = JSON.parse(text);
        required(
          text === `${JSON.stringify(request)}\n`,
          "ambiguous hook read request"
        );
        socket.end(
          `${JSON.stringify({ ok: true, result: dispatchRead(scopes, request, profile.cwd) })}\n`
        );
      } catch {
        socket.end('{"ok":false}\n');
      }
    });
  });
  return { server, connections, state };
}

/** Private pathname ownership and finite requests bound transport; this is not same-user confidentiality. */
export async function startHookReadBroker(profile, token) {
  const scopes = readScopes(profile, token);
  const path = join(profile.home, "hook-reader.sock");
  required(
    Buffer.byteLength(path) <= 103 &&
      realpathSync(profile.home) === profile.home,
    "hook read pathname is unsupported"
  );
  const { server, connections, state } = readServer(profile, scopes);
  let identity;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, resolve);
    });
    identity = lstatSync(path);
    chmodSync(path, 0o600);
    required(
      identity.isSocket() &&
        identity.uid === process.getuid() &&
        (lstatSync(path).mode & 0o777) === 0o600,
      "hook read socket ownership differs"
    );
  } catch (error) {
    await new Promise(resolve => server.close(resolve));
    if (identity) removeOwnedSocket(path, identity);
    throw error;
  }
  let completion;
  const close = () =>
    (completion ??= (async () => {
      state.closing = true;
      clearTimeout(timer);
      for (const socket of connections) socket.destroy();
      await new Promise(resolve => server.close(resolve));
      removeOwnedSocket(path, identity);
    })());
  const timer = setTimeout(() => {
    close().catch(() => {});
  }, profile.deadline - Date.now());
  timer.unref();
  return { path, close };
}

/** Literal public request data crosses IPC; the parent supplies all credentialed execution authority. */
export async function requestHookRead(context, request) {
  const identity = lstatSync(context.path);
  required(
    identity.isSocket() &&
      identity.uid === process.getuid() &&
      (identity.mode & 0o077) === 0 &&
      context.path === join(context.root, "hook-reader.sock") &&
      context.deadline > Date.now(),
    "hook read endpoint is unavailable"
  );
  return new Promise((resolve, reject) => {
    const socket = createConnection(context.path);
    const chunks = [];
    let bytes = 0;
    const timer = setTimeout(
      () => socket.destroy(new Error("hook read phase expired")),
      context.deadline - Date.now()
    );
    socket.on("connect", () => socket.end(`${JSON.stringify(request)}\n`));
    socket.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > 11_185_000)
        socket.destroy(new Error("hook read capture exceeded"));
      else chunks.push(chunk);
    });
    socket.once("error", reject);
    socket.once("close", () => clearTimeout(timer));
    socket.once("end", () => {
      try {
        const response = JSON.parse(Buffer.concat(chunks).toString());
        required(response.ok === true, "hook read request refused");
        resolve(response.result);
      } catch (error) {
        reject(error);
      }
    });
  });
}
