/** Black-box exact-order controls for the bootstrap and detached reaper. */
import { fork, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareOwnedScratchRunRoot } from "../../../src/configs/vitest/scratch.js";
import { assertTestRunPlatform } from "../../../src/cli/lisa-test-run.js";
import { waitForMessage } from "../../../src/cli/lisa-test-run-ipc.js";
import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
} from "../../helpers/io-latency-budget.js";
import {
  PAYLOAD_MARKER,
  REPO_ROOT as TEST_RUN_REPO_ROOT,
  SUPERVISED_SCRATCH_FIXTURE,
  temporaryTestRunDirectory,
  TEST_RUN_ENTRY,
} from "../../helpers/lisa-test-run-process.js";
import { withProcessPlatformTempRoot } from "../../helpers/template-toolchain.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const children: ChildProcess[] = [];
const directories: string[] = [];
const registerTestRunDirectory = (directory: string): void => {
  directories.push(directory);
};

/** Mutable captured process output confined to one child fixture. */
interface ProtocolChild {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly messages: readonly unknown[];
}

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("lisa-test-run protocol entry refusal", () => {
  it("refuses an unsupported platform before protocol startup", () => {
    expect(() => assertTestRunPlatform("win32")).toThrow(/Darwin or Linux/iu);
  });

  it("rejects a missing separator or command as usage exit 2", () => {
    const base = temporaryTestRunDirectory(
      "lisa-test-run-usage-",
      registerTestRunDirectory
    );
    const result = boundedSpawnSync({
      label: "lisa-test-run usage",
      command: process.execPath,
      args: ["--import", "tsx", TEST_RUN_ENTRY],
      baseMs: 2_000,
      cwd: TEST_RUN_REPO_ROOT,
      env: { ...process.env, TMPDIR: base, TMP: base, TEMP: base },
    });
    expect(result.status).toBe(2);
  });

  it("makes raw unsupervised Lisa Vitest setup fail actionably", () => {
    const base = temporaryTestRunDirectory(
      "lisa-test-run-raw-",
      registerTestRunDirectory
    );
    const marker = path.join(base, PAYLOAD_MARKER);
    const inherited = { ...process.env };
    delete inherited["LISA_TEST_RUN_LEASE"];
    const result = boundedSpawnSync({
      label: "raw unsupervised scratch setup",
      command: process.execPath,
      args: ["--import", "tsx", SUPERVISED_SCRATCH_FIXTURE],
      baseMs: 5_000,
      cwd: TEST_RUN_REPO_ROOT,
      env: {
        ...inherited,
        TMPDIR: base,
        TMP: base,
        TEMP: base,
        LISA_TEST_RUN_MARKER: marker,
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("lisa-test-run -- vitest");
    expect(fs.existsSync(marker)).toBe(false);
  });
});

/**
 * Allocate one fresh logical platform temp root.
 * @returns Fresh temp root
 */
function temporaryBase(): string {
  const base = fs.mkdtempSync(path.join(tmpdir(), "protocol-state-"));
  directories.push(base);
  return base;
}

/**
 * Start one source protocol companion with isolated temp authority.
 * @param name - Protocol module basename
 * @param base - Logical platform temp root
 * @returns Running child and bounded observations
 */
function startProtocolChild(
  name: "lisa-test-run-bootstrap" | "lisa-test-run-reaper",
  base: string
): ProtocolChild {
  const output: Buffer[] = [];
  const messages: unknown[] = [];
  const child = fork(path.join(REPO_ROOT, "src/cli", `${name}.ts`), [], {
    cwd: REPO_ROOT,
    execArgv: ["--import", "tsx"],
    env: { ...process.env, TMPDIR: base, TMP: base, TEMP: base },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  children.push(child);
  child.stderr?.on("data", chunk => {
    output.push(Buffer.from(chunk));
  });
  child.on("message", message => {
    messages.push(message);
  });
  return {
    child,
    messages,
    output: () => Buffer.concat(output).toString("utf8"),
  };
}

/**
 * Wait for a protocol child terminal status under the calibrated budget.
 * @param child - Protocol child
 * @returns Terminal exit code
 */
function childExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(child.exitCode);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Protocol child did not exit after refusal")),
      ioLatencyBudgetMs(5_000)
    );
    child.once("exit", code => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/**
 * Callback-settled exact IPC send.
 * @param child - Protocol child
 * @param message - Exact or adversarial message
 * @returns Callback-settled send
 */
function send(child: ChildProcess, message: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    child.send(message, error => (error === null ? resolve() : reject(error)));
  });
}

describe("lisa-test-run protocol state machines", () => {
  it("rejects GO before COMMAND and never starts a payload", async () => {
    const running = startProtocolChild(
      "lisa-test-run-bootstrap",
      temporaryBase()
    );
    await waitForMessage(running.child, "BOOTSTRAP_READY");

    await send(running.child, { schema: 1, type: "GO" });

    expect(await childExit(running.child)).toBe(1);
    expect(running.output()).toMatch(/Unexpected GO.*await-command/iu);
  });

  it("rejects a duplicate COMMAND instead of replacing the first", async () => {
    const running = startProtocolChild(
      "lisa-test-run-bootstrap",
      temporaryBase()
    );
    await waitForMessage(running.child, "BOOTSTRAP_READY");
    const command = {
      schema: 1,
      argv: [process.execPath, "-e", "process.exit(0)"],
      env: { PATH: process.env.PATH ?? "" },
    };
    const ready = waitForMessage(running.child, "COMMAND_READY");
    await send(running.child, { schema: 1, type: "COMMAND", command });
    await ready;

    await send(running.child, { schema: 1, type: "COMMAND", command });

    expect(await childExit(running.child)).toBe(1);
    expect(running.output()).toMatch(/Unexpected COMMAND.*await-go/iu);
  });

  it("rejects malformed target authority before root or deletion", async () => {
    const base = temporaryBase();
    const running = startProtocolChild("lisa-test-run-reaper", base);
    await waitForMessage(running.child, "REAPER_READY");

    await send(running.child, {
      schema: 1,
      type: "TARGET_INTENT",
      correlation: "0".repeat(32),
      target: {},
    });

    await childExit(running.child);
    expect(running.output()).toMatch(/Invalid TARGET_INTENT/iu);
    expect(fs.existsSync(path.join(base, "lisa-scratch"))).toBe(false);
  });

  it("refuses a duplicate root intent after exactly one correlated ACK", async () => {
    const base = temporaryBase();
    const intent = withProcessPlatformTempRoot(base, () =>
      prepareOwnedScratchRunRoot({
        suiteLabel: "lisa",
        registeredPrefixes: ["lisa-"],
      })
    );
    const running = startProtocolChild("lisa-test-run-reaper", base);
    await waitForMessage(running.child, "REAPER_READY");
    const message = {
      schema: 1,
      type: "ROOT_INTENT",
      correlation: intent.token,
      intent,
    };
    const armed = waitForMessage(
      running.child,
      "ROOT_INTENT_ARMED",
      intent.token
    );
    await send(running.child, message);
    await armed;

    await send(running.child, message);

    await childExit(running.child);
    expect(running.output()).toMatch(/Unexpected ROOT_INTENT/iu);
    expect(
      running.messages.filter(
        value => (value as { type?: unknown }).type === "ROOT_INTENT_ARMED"
      )
    ).toHaveLength(1);
    expect(fs.existsSync(intent.rootPath)).toBe(false);
  });
});
