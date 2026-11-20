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

/** The fixture manifest's file name. */
const MANIFEST = "package.json";

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

/** A newer release whose exact-version endpoint answers 404 in one scenario. */
const UNSERVED = "8.2.0";

/** The scenario whose exact-version endpoint answers 404 with an open body. */
const EXACT_404_OPEN = "exact-404-open";

/**
 * How the loopback registry behaves: healthy, or answering an error status
 * whose body it starts and never finishes, on the packument or on one exact
 * version.
 */
type Scenario = "healthy" | "packument-500-open" | typeof EXACT_404_OPEN;

/**
 * A loopback registry serving the self package's packument and its releases.
 * @param scenario - Reads the scenario in force for each request.
 * @returns The running server.
 */
function loopbackRegistry(scenario: () => Scenario): Server {
  return createServer((request, response) => {
    const url = request.url ?? "";
    const mode = scenario();
    const headers = {
      "content-type": "application/json",
      connection: "keep-alive",
    };
    const openError =
      (mode === "packument-500-open" && url === `/${SELF}`) ||
      (mode === EXACT_404_OPEN && url === `/${SELF}/${UNSERVED}`);
    if (openError) {
      response.writeHead(url === `/${SELF}` ? 500 : 404, headers);
      response.write('{"error":"');
      return;
    }
    const listed = mode === EXACT_404_OPEN ? [RELEASE, UNSERVED] : [RELEASE];
    const body =
      url === `/${SELF}`
        ? {
            name: SELF,
            "dist-tags": { latest: RELEASE },
            versions: Object.fromEntries(
              listed.map(version => [version, { name: SELF, version }])
            ),
          }
        : url === `/${SELF}/${RELEASE}`
          ? { name: SELF, version: RELEASE }
          : undefined;
    response.writeHead(body === undefined ? 404 : 200, headers);
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
  const state: {
    server?: Server;
    registry: string;
    dir: string;
    scenario: Scenario;
  } = { registry: "", dir: "", scenario: "healthy" };

  /**
   * Arguments pointing the CLI at the loopback registry and the fixture manifest.
   * @returns The arguments.
   */
  const target = (): string[] => [
    "--registry",
    state.registry,
    "--manifest",
    path.join(state.dir, MANIFEST),
  ];

  beforeAll(async () => {
    const server = loopbackRegistry(() => state.scenario);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    state.server = server;
    state.registry = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    state.dir = mkdtempSync(path.join(tmpdir(), "self-pin-exit-"));
    writeFileSync(
      path.join(state.dir, MANIFEST),
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
    state.scenario = "healthy";
    const run = await runCli([...target(), ...mode]);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain(printed);
    expect(run.lingeredMs).toBeGreaterThanOrEqual(0);
    expect(run.lingeredMs).toBeLessThan(EXIT_BOUND_MS);
  });

  it.each<readonly [string, Scenario, number, string]>([
    [
      "a packument error whose body never ends",
      "packument-500-open",
      1,
      "self-dependency-pin: unprovable",
    ],
    [
      "an exact-version 404 whose body never ends",
      EXACT_404_OPEN,
      0,
      "self-dependency-pin: current",
    ],
  ])("%s", async (_name, scenario, code, printed) => {
    state.scenario = scenario;
    const run = await runCli([...target()]);

    expect(run.code).toBe(code);
    expect(run.stdout).toContain(printed);
    expect(run.lingeredMs).toBeGreaterThanOrEqual(0);
    expect(run.lingeredMs).toBeLessThan(EXIT_BOUND_MS);
  });
});
