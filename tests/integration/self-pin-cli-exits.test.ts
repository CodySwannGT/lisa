/**
 * The self-pin CLI exits as soon as it has printed its verdict
 * (CodySwannGT/lisa#5094).
 *
 * A pending timer keeps a Node process alive after its work is done. The
 * per-attempt deadline arms one timer per packument read (60s) and the
 * exact-version prover arms one per probe (10s), so a timer that is not
 * cleared would leave `check:self-pin` sitting idle, at 0% CPU, until it
 * fires: the pre-push would wait on a check that has already answered.
 *
 * Each case runs the real script as a child process against a loopback
 * registry served from this test, with keep-alive connections left open the
 * way a real registry leaves them, and measures the time from the verdict
 * line to the process exit. Nothing here reaches the public network.
 * @module tests/integration/self-pin-cli-exits
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = path.resolve("scripts/check-self-dependency-pin.mjs");

/** The package the loopback registry serves. */
const SELF = "@codyswann/lisa";

/** The one release the loopback registry publishes. */
const RELEASE = "8.1.1";

/**
 * How long the process may live after printing its verdict. Far below the
 * shortest timer the script arms (10s), so a leaked timer cannot pass.
 */
const EXIT_BOUND_MS = 3000;

/** How long one case may run before it is killed and reported. */
const CASE_KILL_MS = 30_000;

/** What one CLI run printed and how long it lived after printing. */
interface CliRun {
  /** Exit code, or null when the case had to kill it. */
  readonly code: number | null;
  /** Everything written to stdout. */
  readonly stdout: string;
  /** Milliseconds from the first stdout write to process exit. */
  readonly lingeredMs: number;
}

/**
 * A loopback registry serving the self package's packument and one release.
 * @returns The running server.
 */
function loopbackRegistry(): Server {
  return createServer((request, response) => {
    const url = request.url ?? "";
    const body =
      url === `/${SELF}`
        ? {
            name: SELF,
            "dist-tags": { latest: RELEASE },
            versions: {
              [RELEASE]: { name: SELF, version: RELEASE },
            },
          }
        : url === `/${SELF}/${RELEASE}`
          ? { name: SELF, version: RELEASE }
          : undefined;
    response.writeHead(body === undefined ? 404 : 200, {
      "content-type": "application/json",
      connection: "keep-alive",
    });
    response.end(JSON.stringify(body ?? {}));
  });
}

/**
 * Run the CLI and time how long it lives after its first output.
 * @param args - CLI arguments.
 * @returns What it printed and how long it lingered.
 */
function runCli(args: readonly string[]): Promise<CliRun> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const state = { stdout: "", printedAt: 0 };
    child.stdout.on("data", chunk => {
      if (state.printedAt === 0) state.printedAt = Date.now();
      state.stdout += String(chunk);
    });
    const kill = setTimeout(() => child.kill("SIGKILL"), CASE_KILL_MS);
    child.on("close", code => {
      clearTimeout(kill);
      resolve({
        code,
        stdout: state.stdout,
        lingeredMs: state.printedAt === 0 ? -1 : Date.now() - state.printedAt,
      });
    });
  });
}

describe("the self-pin CLI exits once its verdict is printed (#5094)", () => {
  const state: { server?: Server; registry: string; dir: string } = {
    registry: "",
    dir: "",
  };

  beforeAll(async () => {
    const server = loopbackRegistry();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    state.server = server;
    state.registry = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    state.dir = mkdtempSync(path.join(tmpdir(), "self-pin-exit-"));
    writeFileSync(
      path.join(state.dir, "package.json"),
      JSON.stringify({ devDependencies: { [SELF]: "^8.0.0" } })
    );
  });

  afterAll(async () => {
    state.server?.closeAllConnections();
    await new Promise(resolve => state.server?.close(resolve));
    rmSync(state.dir, { recursive: true, force: true });
  });

  it.each([
    ["the pin check", [], "self-dependency-pin: current"],
    ["the newest-installable lookup", ["--newest-installable"], `${RELEASE}\n`],
    ["the awaited-listed wait", ["--await-listed", RELEASE], "listed"],
  ])("%s", async (_name, mode, printed) => {
    const run = await runCli([
      "--registry",
      state.registry,
      "--manifest",
      path.join(state.dir, "package.json"),
      ...mode,
    ]);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain(printed);
    expect(run.lingeredMs).toBeGreaterThanOrEqual(0);
    expect(run.lingeredMs).toBeLessThan(EXIT_BOUND_MS);
  });
});
