import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
const root = process.cwd(),
  dir = path.join(root, ".lisa/evidence/4335");
const { host } = JSON.parse(
  await readFile(path.join(dir, "verify-host-location.json"), "utf8")
);
const server = spawn(
  "/Users/cody/.local/bin/codex",
  ["app-server", "--stdio"],
  {
    cwd: host,
    stdio: ["pipe", "pipe", "pipe"],
  }
);
const readers = createInterface({ input: server.stdout });
const pending = new Map();
const state = { next: 0 };
const stderr = [];
server.stderr.on("data", c => {
  stderr.push(c);
});
readers.on("line", line => {
  try {
    const message = JSON.parse(line);
    if (pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  } catch {
    // Native startup output outside the JSON-RPC stream is not an RPC response.
  }
});
/**
 * Read the native public protocol without changing configuration or trust.
 * @param method Public JSON-RPC method.
 * @param params Native method parameters.
 * @returns Actual native response envelope.
 */
async function rpc(method, params) {
  const id = ++state.next;
  const response = new Promise(resolve => pending.set(id, resolve));
  server.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  return response;
}
await rpc("initialize", {
  clientInfo: { name: "lisa-local-verifier", version: "1" },
  capabilities: { experimentalApi: true },
});
server.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
const response = await rpc("hooks/list", { cwds: [host] });
const ANONYMOUS_HOST = "<anonymous-host>";
const redact = s =>
  s
    .replaceAll(`/private${host}`, ANONYMOUS_HOST)
    .replaceAll(host, ANONYMOUS_HOST)
    .replaceAll(root, "<lisa-worktree>");
const result = response.result
  ? {
      captured_at: new Date().toISOString(),
      method: "hooks/list",
      startupStderr: stderr.join("").slice(-2000),
      entries: response.result.data.map(entry => ({
        cwd: ANONYMOUS_HOST,
        sourceCounts: Object.fromEntries(
          [...new Set(entry.hooks.map(h => h.source))].map(source => [
            source,
            entry.hooks.filter(h => h.source === source).length,
          ])
        ),
        errors: entry.errors,
        warnings: entry.warnings,
        projectHooks: entry.hooks
          .filter(h => h.source === "project")
          .map(h => ({
            ...h,
            sourcePath: redact(h.sourcePath),
            command: h.command ? redact(h.command) : undefined,
          })),
      })),
    }
  : { error: response.error };
await writeFile(
  path.join(dir, "verify-native-hooks-list.json"),
  `${redact(JSON.stringify(result, null, 2))}\n`
);
console.log(JSON.stringify(result, null, 2));
server.stdin.end();
readers.close();
server.kill("SIGTERM");
