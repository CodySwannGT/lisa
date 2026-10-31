/**
 * The stdin token launch against a REAL tmux (CodySwannGT/lisa#4555, part 2).
 *
 * Every other suite runs `start` against a stub tmux, which proves the CLI
 * hands tmux the line `buildSourcedLaunch` built, but not that a real tmux
 * reads that line back the way the quoting assumes. This suite pipes the
 * exact `{argv, input}` into a real tmux and checks, from inside the child
 * the session started, that:
 * - the child saw the exact bot token (compared by sha256);
 * - a value holding `'`, `"` and `$` survived tmux's parser intact;
 * - the argv also arrived word for word (the settings JSON holds `"`);
 * - `ps` never showed the token on any process while the launch ran — and
 *   the `ps` scan is first proven able to fail, against a decoy process that
 *   holds the token in its argv.
 *
 * Isolation is the whole safety story. Every tmux call names a private
 * server (`-L lisa4555-<random>`) under a private `TMUX_TMPDIR`, with no
 * user config (`-f /dev/null`), a private HOME and no inherited `TMUX`; the
 * default tmux server and every existing session are never addressed. The
 * private server is killed and the dirs removed afterwards. The token is a
 * random fake sentinel, and the child is a stub `claude` script.
 *
 * It runs only when a real `tmux` is on PATH, and otherwise skips with the
 * reason printed.
 * @module tests/unit/session-manager/launch-real-tmux
 */
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildManagerLaunch,
  buildSourcedLaunch,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/launch.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

/** macOS and Linux both cap a unix socket path at about 104 bytes. */
const SOCKET_PATH_LIMIT = 104;

/** `ps` by absolute path: `/bin/ps` on both macOS and Linux. */
const PS = "/bin/ps";

/** Room for a busy host's full process table with unlimited-width args. */
const PS_MAX_BUFFER = 16 * 1024 * 1024;

/** How often the `ps` scan samples the process table, in ms. */
const PS_INTERVAL_MS = 25;

/** How long the stub child stays alive after recording, in seconds. */
const CHILD_LINGER_S = 2;

/** Longest wait for the stub child to record what it saw, in ms. */
const CHILD_TIMEOUT_MS = 15_000;

/**
 * The first executable `tmux` on PATH, or null.
 * @returns Absolute path, or null
 */
function findTmux(): string | null {
  const dirs = (process.env["PATH"] ?? "").split(path.delimiter);
  const found = dirs
    .filter(Boolean)
    .map(dir => path.join(dir, "tmux"))
    .find(candidate => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  return found ?? null;
}

/**
 * A short scratch base: socket paths are length-capped, and a per-run
 * TMPDIR can be long. macOS's per-user temp dir is short and private.
 * @returns Absolute directory
 */
function shortTempBase(): string {
  if (process.platform === "darwin") {
    const result = boundedSpawnSync({
      label: "getconf DARWIN_USER_TEMP_DIR",
      command: "/usr/bin/getconf",
      args: ["DARWIN_USER_TEMP_DIR"],
    });
    const dir = result.status === 0 ? result.stdout.trim() : "";
    if (dir && existsSync(dir)) return dir;
  }
  return tmpdir();
}

/**
 * sha256 hex of a string, so assertions never print the value itself.
 * @param value - Text
 * @returns Hex digest
 */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Every `ps` line holding `needle`, sampled until `until()` resolves.
 * `-ww` lifts the column cap, so a value deep in a long argv is still seen.
 * @param needle - Text to look for
 * @param until - Resolves when sampling should stop
 * @returns Matching lines (empty when none was ever seen)
 */
async function scanProcessTable(
  needle: string,
  until: Promise<unknown>
): Promise<string[]> {
  let done = false;
  const stop = () => {
    done = true;
  };
  const hits = new Set<string>();
  const sample = () => {
    const ps = boundedSpawnSync({
      label: "ps -A -ww -o args=",
      command: PS,
      args: ["-A", "-ww", "-o", "args="],
      maxBuffer: PS_MAX_BUFFER,
    });
    ps.stdout
      .split("\n")
      .filter(line => line.includes(needle))
      .forEach(line => hits.add(line));
  };
  until.then(stop, stop);
  while (!done) {
    sample();
    await new Promise(resolve => setTimeout(resolve, PS_INTERVAL_MS));
  }
  sample();
  return [...hits];
}

/**
 * Resolve once `file` exists, or reject after the timeout.
 * @param file - Path to wait for
 * @returns Resolves when present
 */
async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + CHILD_TIMEOUT_MS;
  while (!existsSync(file)) {
    if (Date.now() > deadline) {
      throw new Error(`stub child never wrote ${path.basename(file)}`);
    }
    await new Promise(resolve => setTimeout(resolve, PS_INTERVAL_MS));
  }
}

const tmuxPath = findTmux();
if (!tmuxPath) {
  console.log(
    "launch-real-tmux: skipped — no tmux on PATH, so the stdin token " +
      "launch cannot be checked against a real tmux here."
  );
}

const SENTINEL = `123456789:SENTINEL-${randomBytes(16).toString("hex")}`;
const PROBE = `it's "quoted" $HOME \`x\` $(nope) \\ end`;
const SERVER = `lisa4555-${randomBytes(4).toString("hex")}`;

let base = "";
let serverEnv: NodeJS.ProcessEnv = {};
let recordDir = "";
let root = "";
let scriptsDir = "";

/**
 * Run one tmux command against the private server only.
 * @param args - tmux arguments after the server selection
 * @returns The completed child (a non-zero status is returned, not thrown)
 */
function privateTmux(args: readonly string[]) {
  return boundedSpawnSync({
    label: `tmux -L ${SERVER} ${args.join(" ")}`,
    command: tmuxPath as string,
    args: ["-L", SERVER, "-f", "/dev/null", ...args],
    env: serverEnv,
  });
}

describe.skipIf(!tmuxPath)("buildSourcedLaunch against a real tmux", () => {
  beforeAll(() => {
    base = mkdtempSync(path.join(shortTempBase(), "lisa-t"));
    const uid = process.getuid?.() ?? 0;
    const socket = path.join(base, `tmux-${uid}`, SERVER);
    if (Buffer.byteLength(socket) >= SOCKET_PATH_LIMIT) {
      throw new Error(
        `tmux socket path is ${Buffer.byteLength(socket)} bytes; the limit ` +
          `is ${SOCKET_PATH_LIMIT}. Set TMPDIR shorter.`
      );
    }
    const binDir = path.join(base, "bin");
    recordDir = path.join(base, "rec");
    root = path.join(base, "root");
    scriptsDir = path.join(base, "scripts");
    [binDir, recordDir, root, scriptsDir].forEach(dir =>
      mkdirSync(dir, { recursive: true })
    );
    // The stub manager: record what tmux handed it, then linger so the
    // session is alive while `ps` is sampled.
    const stub = path.join(binDir, "claude");
    writeFileSync(
      stub,
      [
        "#!/bin/sh",
        `rec='${recordDir}'`,
        `printf '%s' "$TELEGRAM_BOT_TOKEN" > "$rec/token"`,
        `printf '%s' "$SM_QUOTE_PROBE" > "$rec/probe"`,
        `: > "$rec/argv"`,
        `for arg in "$@"; do printf '%s\\n' "$arg" >> "$rec/argv"; done`,
        `pwd -P > "$rec/cwd"`,
        `: > "$rec/done"`,
        `sleep ${CHILD_LINGER_S}`,
        "",
      ].join("\n")
    );
    chmodSync(stub, 0o755);
    serverEnv = {
      PATH: `${binDir}${path.delimiter}/usr/bin${path.delimiter}/bin`,
      HOME: base,
      TMUX_TMPDIR: base,
      LANG: "C",
    };
  });

  afterAll(() => {
    if (base) {
      privateTmux(["kill-server"]);
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("the ps scan can fail: it sees a decoy holding the token in argv", async () => {
    const decoy = spawn(process.execPath, [
      "-e",
      "setTimeout(() => {}, 30000)",
      "x".repeat(300),
      `TELEGRAM_BOT_TOKEN=${SENTINEL}`,
    ]);
    try {
      const hits = await scanProcessTable(
        SENTINEL,
        new Promise(resolve => setTimeout(resolve, 300))
      );
      expect(hits.length).toBeGreaterThan(0);
    } finally {
      decoy.kill("SIGKILL");
      await new Promise(resolve => decoy.once("exit", resolve));
    }
  });

  it("delivers the token and quoted values to the child, never via argv", async () => {
    const argv = buildManagerLaunch({
      name: SERVER,
      root,
      stateDir: path.join(base, "state"),
      scriptsDir,
      interval: "5m",
      notify: "telegram",
    });
    const launch = buildSourcedLaunch(argv, {
      TELEGRAM_BOT_TOKEN: SENTINEL,
      SM_QUOTE_PROBE: PROBE,
    });
    const recorded = waitForFile(path.join(recordDir, "done")).then(
      () => new Promise(resolve => setTimeout(resolve, 500))
    );
    const client = spawn(
      tmuxPath as string,
      ["-L", SERVER, "-f", "/dev/null", ...launch.argv],
      { env: serverEnv, stdio: ["pipe", "ignore", "ignore"] }
    );
    const exited = new Promise<number | null>(resolve =>
      client.once("exit", code => resolve(code))
    );
    client.stdin.end(launch.input);
    const [hits, status] = await Promise.all([
      scanProcessTable(SENTINEL, Promise.all([recorded, exited])),
      exited,
    ]);

    expect(status).toBe(0);
    expect(hits).toHaveLength(0);
    const seen = readFileSync(path.join(recordDir, "token"), "utf8");
    expect(sha256(seen)).toBe(sha256(SENTINEL));
    expect(readFileSync(path.join(recordDir, "probe"), "utf8")).toBe(PROBE);
    const childArgv = readFileSync(path.join(recordDir, "argv"), "utf8")
      .split("\n")
      .slice(0, -1);
    expect(childArgv).toEqual(argv.slice(argv.indexOf("claude") + 1));
    expect(readFileSync(path.join(recordDir, "cwd"), "utf8").trim()).toBe(
      realpathSync(root)
    );
  });
});
