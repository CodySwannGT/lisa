/**
 * @file history-secret-download-routes.test.ts
 * @description Controlled transport reaches the real provisioner without qualifying fake bytes.
 * @module tests/history-secrets
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();
const cli = resolve(
  import.meta.dirname,
  "../../../all/copy-overwrite/scripts/lisa-history-secrets.mjs"
);
const canary = "untrusted-transport-diagnostic-must-stay-private";
const platforms = [
  ["darwin", "arm64", 378332059],
  ["darwin", "x64", 378332053],
  ["linux", "arm64", 378332057],
  ["linux", "x64", 378332058],
] as const;

/**
 * Run the actual CLI with controlled HTTP input, never a substitute scanner.
 * @param modes - Successive transport outcomes
 * @param platform - Selected supported operating system
 * @param arch - Selected supported architecture
 * @returns Process outcome, route trace and destination existence
 */
function provision(modes: string[], platform = "linux", arch = "x64") {
  const folder = mkdtempSync(join(tmpdir(), "history-download-routes-"));
  try {
    const preload = join(folder, "transport.mjs");
    const trace = join(folder, "trace.jsonl");
    const destination = join(folder, "scanner");
    writeFileSync(trace, "");
    writeFileSync(
      preload,
      `
import { appendFileSync } from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const record = value => appendFileSync(${JSON.stringify(trace)}, JSON.stringify(value) + "\\n");
Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });
Object.defineProperty(process, "arch", { value: ${JSON.stringify(arch)} });
const controller = new AbortController();
AbortSignal.timeout = ms => { record({ deadline: ms }); return controller.signal; };
childProcess.spawnSync = () => { record({ spawned: true }); throw new Error(${JSON.stringify(canary)}); };
syncBuiltinESMExports();
const modes = ${JSON.stringify(modes)};
globalThis.fetch = async (url, options) => {
  record({ url, headers: options.headers ?? null, sameSignal: options.signal === controller.signal });
  const mode = modes.shift();
  if (mode === "abort" || mode === "http-abort") controller.abort();
  if (mode === "throw" || mode === "abort" || !mode) throw new Error(${JSON.stringify(canary)});
  return {
    ok: !mode.startsWith("http"),
    status: mode.startsWith("http") ? 504 : 200,
    body: { cancel: async () => {
      record({ cancelled: true });
      if (mode === "http-cancel-throw") throw new Error(${JSON.stringify(canary)});
    } },
    arrayBuffer: async () => {
      record({ body: true });
      if (mode === "body") throw new Error(${JSON.stringify(canary)});
      return new TextEncoder().encode("deliberately unqualified archive").buffer;
    },
  };
};
`
    );
    const result = boundedSpawnSync({
      label: "real provision CLI with controlled HTTP routes",
      command: process.execPath,
      args: ["--import", preload, cli, "provision", destination],
      cwd: folder,
      baseMs: 30000,
    });
    const events = readFileSync(trace, "utf8")
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));
    return {
      status: result.status,
      signal: result.signal,
      stdout: String(result.stdout),
      stderr: String(result.stderr),
      events,
      destinationExists: existsSync(destination),
    };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * Assert refusals are authored, finite and never execute unqualified input.
 * @param result - Actual controlled CLI outcome
 * @param guidance - Expected phase-specific refusal
 */
function expectRefusal(result: ReturnType<typeof provision>, guidance: string) {
  expect(result.status).toBe(1);
  expect(result.signal).toBeNull();
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).toBe(guidance);
  expect(result.stderr).not.toContain(canary);
  expect(result.destinationExists).toBe(false);
  expect(result.events.filter(event => event.spawned)).toEqual([]);
  expect(result.events.filter(event => event.deadline)).toEqual([
    { deadline: 120000 },
  ]);
  expect(
    result.events.filter(event => event.url).every(event => event.sameSignal)
  ).toBe(true);
}

const transfer =
  "Pinned scanner archive transfer failed. Restore access to the official release and retry provisioning.";
const setup =
  "Pinned scanner download setup failed. Restore access to the official release and retry provisioning.";
const download =
  "Pinned scanner download failed. Restore access to the official release and retry provisioning.";

describe("official pinned scanner download routing", () => {
  it.each(platforms)(
    "routes %s/%s to its exact official asset after HTTP failure",
    (platform, arch, asset) => {
      const result = provision(["http", "body"], platform, arch);
      expectRefusal(result, transfer);
      const routes = result.events.filter(event => event.url);
      expect(routes.map(event => event.url)).toEqual([
        `https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_${platform}_${arch}.tar.gz`,
        `https://api.github.com/repos/gitleaks/gitleaks/releases/assets/${asset}`,
      ]);
      expect(routes[1].headers).toMatchObject({
        Accept: "application/octet-stream",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": expect.any(String),
      });
    }
  );

  it.each([
    [["throw", "body"], transfer, 2],
    [["http-cancel-throw", "body"], transfer, 2],
    [["throw", "throw"], setup, 2],
    [["http", "http"], download, 2],
    [["body", "body"], transfer, 1],
    [
      ["checksum", "body"],
      "Scanner archive checksum mismatch. Discard the download and restore the official pinned release.",
      1,
    ],
    [["abort", "body"], setup, 1],
    [["http-abort", "body"], download, 1],
  ] as const)(
    "preserves finite refusal for %j",
    (modes, guidance, requests) => {
      const result = provision([...modes]);
      expectRefusal(result, guidance);
      expect(result.events.filter(event => event.url)).toHaveLength(requests);
    }
  );
});
