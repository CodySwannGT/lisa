// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Private native transport executes immutable controller recipes, never request-supplied authority. */
import { createServer } from "node:net";
import { chmodSync, lstatSync, realpathSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { required, keys } from "./npm-update-contract.mjs";
import { binaryDigest } from "./npm-update-isolation.mjs";
import { currentGraph } from "./npm-update-orchestrator.mjs";
import {
  checkedRecipe,
  executeRecipe,
} from "./npm-update-controller-recipe.mjs";

/** Only the controller supplies independently authenticated graph and immutable phase recipes. */
function recipesFor(authority) {
  const { root, node, graph, deadline, recipes } = authority;
  const stat = lstatSync(root);
  required(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      realpathSync(root) === root &&
      stat.uid === process.getuid() &&
      (stat.mode & 0o077) === 0,
    "broker root is not private controller storage"
  );
  required(
    Number.isSafeInteger(deadline) &&
      deadline > Date.now() &&
      deadline <= Date.now() + 1_800_000,
    "invalid broker lifetime"
  );
  required(
    node.path === realpathSync(node.path) &&
      binaryDigest(node.path) === node.sha256,
    "broker controller Node identity differs"
  );
  required(
    graph && Object.keys(graph).length > 0 && Object.keys(graph).length <= 128,
    "broker graph is absent or unbounded"
  );
  required(
    Array.isArray(recipes) && recipes.length > 0 && recipes.length <= 64,
    "broker recipes are absent or unbounded"
  );
  const selected = new Map();
  for (const recipe of recipes) {
    required(!selected.has(recipe.id), "duplicate broker recipe");
    selected.set(recipe.id, checkedRecipe(recipe, node, graph));
  }
  return { selected, graph: { ...graph }, node: { ...node }, deadline, root };
}

function actualGraph(expected) {
  const observed = currentGraph(expected);
  required(
    Object.entries(expected).every(([path, hash]) => observed[path] === hash),
    "broker authenticated helper graph changed"
  );
}

function response(result) {
  return {
    ok: true,
    code: result.code,
    stdout: result.stdout.toString("base64"),
    stderr: result.stderr.toString("base64"),
  };
}

/** Unix pathname permissions protect access; Node does not claim SO_PEERCRED observation. */
export async function startControllerBroker(authority) {
  const { selected, graph, node, deadline, root } = recipesFor(authority);
  actualGraph(graph);
  const path = join(root, "controller.sock");
  required(
    Buffer.byteLength(path) <= 103,
    "broker socket path exceeds native bound"
  );
  const connections = new Set();
  const running = new Set();
  const state = { closing: false };
  const server = brokerServer({
    state,
    connections,
    running,
    selected,
    graph,
    node,
    deadline,
  });
  const identity = await listenSocket(server, path);
  let completion;
  const finish = async () => {
    state.closing = true;
    clearTimeout(timer);
    for (const socket of connections) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await Promise.allSettled(running);
    try {
      const current = lstatSync(path);
      required(
        current.dev === identity.dev &&
          current.ino === identity.ino &&
          current.isSocket(),
        "broker cleanup ownership changed"
      );
      unlinkSync(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  };
  const close = () => (completion ??= finish());
  const timer = setTimeout(() => {
    close().catch(() => {});
  }, deadline - Date.now());
  timer.unref();
  return { path, close };
}

/** A failure after native bind still closes the owned listener before returning a refusal. */
async function listenSocket(server, path) {
  let identity;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, resolve);
    });
    identity = lstatSync(path);
    required(
      identity.isSocket() && identity.uid === process.getuid(),
      "broker socket ownership differs"
    );
    chmodSync(path, 0o600);
    required(
      (lstatSync(path).mode & 0o077) === 0,
      "broker socket permissions differ"
    );
    return identity;
  } catch (error) {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (identity) {
      try {
        const current = lstatSync(path);
        required(
          current.dev === identity.dev && current.ino === identity.ino,
          "broker startup cleanup ownership changed"
        );
        unlinkSync(path);
      } catch (cleanup) {
        if (cleanup.code !== "ENOENT") throw cleanup;
      }
    }
    throw error;
  }
}

function brokerServer({
  state,
  connections,
  running,
  selected,
  graph,
  node,
  deadline,
}) {
  return createServer({ allowHalfOpen: true }, socket => {
    if (state.closing || connections.size >= 64) return socket.destroy();
    connections.add(socket);
    const cancel = new AbortController();
    socket.setTimeout(Math.min(10_000, deadline - Date.now()));
    socket.on("timeout", () => socket.destroy());
    socket.on("error", () => {});
    socket.on("close", () => {
      cancel.abort();
      connections.delete(socket);
    });
    let bytes = Buffer.alloc(0);
    socket.on("data", chunk => {
      if (bytes.length + chunk.length > 1024) return socket.destroy();
      bytes = Buffer.concat([bytes, chunk]);
    });
    socket.on("end", () => {
      socket.setTimeout(0);
      const operation = handleRequest(
        socket,
        bytes,
        selected,
        graph,
        deadline,
        cancel.signal,
        node
      );
      running.add(operation);
      operation.finally(() => running.delete(operation));
    });
  });
}

/** Requests supply only a recipe identifier; command/caller/phase/env/input never cross this boundary. */
async function handleRequest(
  socket,
  bytes,
  recipes,
  graph,
  deadline,
  signal,
  node
) {
  let output;
  try {
    const text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
    required(
      text.endsWith("\n") && text.indexOf("\n") === text.length - 1,
      "invalid broker framing"
    );
    const request = JSON.parse(text);
    keys(request, ["recipe"]);
    required(
      text === `${JSON.stringify(request)}\n` &&
        typeof request.recipe === "string" &&
        recipes.has(request.recipe),
      "unknown or ambiguous broker recipe"
    );
    actualGraph(graph);
    const recipe = recipes.get(request.recipe);
    recipes.delete(request.recipe);
    output = response(await executeRecipe(recipe, deadline, signal, node));
  } catch {
    output = { ok: false, error: "controller request refused" };
  }
  if (!socket.destroyed) socket.end(`${JSON.stringify(output)}\n`);
}
