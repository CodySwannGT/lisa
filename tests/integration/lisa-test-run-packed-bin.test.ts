/** Packed npm-bin boundary proof for the foreground test supervisor. */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { fsLatencyBudgetMs } from "../helpers/fs-latency-budget.js";
import { resolveGit } from "../support/git-executable.js";

// Packing and extracting the real package are external-I/O children. Scale the
// hook and case budgets with the same measured machine factor as those children
// so the named child deadline always fires before Vitest's generic timeout.
useIoLatencyBudget();

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const TEST_ROOT = fs.mkdtempSync(
  path.join(tmpdir(), "lisa-test-run-packed-bin-")
);
const PACKAGE_ROOT = path.join(TEST_ROOT, "node_modules", "@codyswann", "lisa");
const BIN_ROOT = path.join(TEST_ROOT, "node_modules", ".bin");
const BIN = path.join(BIN_ROOT, "lisa-test-run");
const PACKED_ENTRY = path.join(PACKAGE_ROOT, "dist/cli/lisa-test-run.js");
const PAYLOAD = path.join(TEST_ROOT, "payload.mjs");
const SCRATCH_NAMESPACE = "lisa-scratch";
const ADVERSARIAL_DIST_NAME = `lisa-packed-bin-adversarial-${process.pid}.map`;
const GIT_BIN = resolveGit();

/** Live writer used to prove packing never reads the mutable checkout. */
interface AdversarialDistWriter {
  readonly target: string;
  readonly child: ReturnType<typeof spawn>;
  readonly exited: Promise<unknown[]>;
}

/**
 * Start one adversarial writer against a checkout's live dist tree.
 * @param root - Checkout root whose dist tree may initially be absent
 * @returns Running writer and its sentinel path
 */
function startAdversarialDistWriter(root: string): AdversarialDistWriter {
  const target = path.join(root, "dist", "cli", ADVERSARIAL_DIST_NAME);
  const child = (() => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "live-dist-writer-started", "utf8");
    return spawn(
      process.execPath,
      [
        "--eval",
        [
          'const fs = require("node:fs");',
          "const target = process.argv[1];",
          "let turn = 0;",
          "setInterval(() => {",
          '  fs.writeFileSync(target, `${turn}:${"x".repeat(turn % 2 === 0 ? 1 : 65536)}`, "utf8");',
          "  turn += 1;",
          "}, 1);",
        ].join("\n"),
        target,
      ],
      { stdio: "ignore" }
    );
  })();
  return { target, child, exited: once(child, "exit") };
}

/** Pack and extract the exact checkout into npm's Unix bin layout. */
beforeAll(async () => {
  const staging = path.join(TEST_ROOT, "pack");
  const checkout = path.join(TEST_ROOT, "checkout");
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(checkout, { recursive: true });
  const writer = startAdversarialDistWriter(REPO_ROOT);
  let packed;
  try {
    const indexed = boundedSpawnSync({
      label: "copy immutable index for lisa-test-run bin proof",
      command: GIT_BIN,
      args: ["checkout-index", "--all", `--prefix=${checkout}/`],
      baseMs: 20_000,
      cwd: REPO_ROOT,
    });
    expect(indexed.status, indexed.stderr).toBe(0);
    fs.symlinkSync(
      path.join(REPO_ROOT, "node_modules"),
      path.join(checkout, "node_modules"),
      "dir"
    );
    const built = boundedSpawnSync({
      label: "build immutable checkout for lisa-test-run bin proof",
      command: "bun",
      args: ["run", "build:dist:in-place"],
      baseMs: 30_000,
      cwd: checkout,
    });
    expect(built.status, built.stderr).toBe(0);
    packed = boundedSpawnSync({
      label: "npm pack for lisa-test-run bin proof",
      command: "npm",
      args: ["pack", "--ignore-scripts", "--pack-destination", staging],
      baseMs: 30_000,
      cwd: checkout,
    });
    expect(packed.status, packed.stderr).toBe(0);
  } finally {
    writer.child.kill("SIGTERM");
    await writer.exited;
    fs.rmSync(writer.target, { force: true });
  }
  const archive = fs.readdirSync(staging).find(entry => entry.endsWith(".tgz"));
  expect(archive).toBeDefined();

  fs.mkdirSync(PACKAGE_ROOT, { recursive: true });
  const extracted = boundedSpawnSync({
    label: "extract packed lisa-test-run",
    command: "tar",
    args: [
      "-xzf",
      path.join(staging, archive ?? "missing.tgz"),
      "--strip-components=1",
      "-C",
      PACKAGE_ROOT,
    ],
    baseMs: 20_000,
  });
  expect(extracted.status, extracted.stderr).toBe(0);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")
  ) as { readonly bin?: Readonly<Record<string, string>> };
  expect(manifest.bin?.["lisa-test-run"]).toBe(
    path.relative(PACKAGE_ROOT, PACKED_ENTRY)
  );
  fs.mkdirSync(BIN_ROOT, { recursive: true });
  // eslint-disable-next-line sonarjs/file-permissions -- npm bin targets must be executable in the real packed-layout boundary.
  fs.chmodSync(PACKED_ENTRY, 0o755);
  fs.symlinkSync(path.relative(BIN_ROOT, PACKED_ENTRY), BIN);
  fs.writeFileSync(
    PAYLOAD,
    [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(process.env.LISA_PACKED_BIN_MARKER, "ran", "utf8");',
      'if (process.env.LISA_PACKED_BIN_MODE === "exit") process.exitCode = 23;',
      'if (process.env.LISA_PACKED_BIN_MODE === "signal") process.kill(process.pid, "SIGTERM");',
    ].join("\n"),
    "utf8"
  );
}, ioLatencyBudgetMs(90_000));

// The one hook in this file whose cost is deletion rather than spawning, so
// it carries its own filesystem-scaled budget instead of inheriting the
// file-level spawn-scaled one. The cases here really do spawn a packed binary
// and keep the spawn budget; only the teardown changes (CodySwannGT/lisa#3936).
const TEARDOWN_BASE_MS = 30_000;

afterAll(() => {
  fs.rmSync(TEST_ROOT, { force: true, recursive: true });
}, fsLatencyBudgetMs(TEARDOWN_BASE_MS));

/**
 * Run one packed bin payload and retain its observed result.
 * @param mode - Terminal outcome the fixture should produce.
 * @returns The isolated scratch paths and observed child result.
 */
function runPacked(mode: "exit" | "signal") {
  const base = fs.mkdtempSync(path.join(TEST_ROOT, `${mode}-`));
  const marker = path.join(base, "payload.marker");
  const childEnv = {
    ...process.env,
    LISA_TEST_SCRATCH_SUITE: "lisa",
    LISA_PACKED_BIN_MARKER: marker,
    LISA_PACKED_BIN_MODE: mode,
    TMPDIR: base,
    TMP: base,
    TEMP: base,
  };
  const args = [
    "--profile",
    "lisa",
    "--adapter",
    "direct",
    "--",
    process.execPath,
    PAYLOAD,
  ];
  const result =
    mode === "exit"
      ? boundedSpawnSync({
          label: `packed npm-bin lisa-test-run ${mode}`,
          command: BIN,
          args,
          baseMs: 15_000,
          cwd: TEST_ROOT,
          env: childEnv,
        })
      : spawnSync(BIN, args, {
          cwd: TEST_ROOT,
          encoding: "utf8",
          env: childEnv,
          timeout: ioLatencyBudgetMs(15_000),
        });
  return { base, marker, result };
}

describe.skipIf(process.platform === "win32")(
  "packed lisa-test-run npm bin",
  () => {
    it("packs an immutable checkout while live dist is concurrently rewritten", () => {
      expect(
        fs.existsSync(
          path.join(PACKAGE_ROOT, "dist", "cli", ADVERSARIAL_DIST_NAME)
        )
      ).toBe(false);
    });

    it("creates a missing dist parent before starting the adversarial writer", async () => {
      const freshCheckout = fs.mkdtempSync(
        path.join(TEST_ROOT, "fresh-checkout-")
      );
      const writer = startAdversarialDistWriter(freshCheckout);
      try {
        expect(fs.readFileSync(writer.target, "utf8")).toBe(
          "live-dist-writer-started"
        );
      } finally {
        writer.child.kill("SIGTERM");
        await writer.exited;
      }
    });

    it.each([
      ["exit", 23, null],
      ["signal", null, "SIGTERM"],
    ] as const)(
      "runs its payload marker and preserves %s outcome",
      (mode, expectedStatus, expectedSignal) => {
        const run = runPacked(mode);
        expect(run.result.status, run.result.stderr).toBe(expectedStatus);
        expect(run.result.signal, run.result.stderr).toBe(expectedSignal);
        expect(run.result.error, run.result.stderr).toBeUndefined();
        expect(fs.existsSync(run.base), run.result.stderr).toBe(true);
        expect(fs.readFileSync(run.marker, "utf8")).toBe("ran");
        expect(fs.readdirSync(path.join(run.base, SCRATCH_NAMESPACE))).toEqual(
          []
        );
      }
    );

    it("does not auto-run when the packed CLI is imported as a library", () => {
      const imported = boundedSpawnSync({
        label: "import packed lisa-test-run as a library",
        command: process.execPath,
        args: [
          "--input-type=module",
          "--eval",
          `await import(${JSON.stringify(pathToFileURL(PACKED_ENTRY).href)});`,
        ],
        baseMs: 5_000,
        cwd: TEST_ROOT,
      });
      expect(imported.status, imported.stderr).toBe(0);
      expect(imported.stdout).toBe("");
    });
  }
);
