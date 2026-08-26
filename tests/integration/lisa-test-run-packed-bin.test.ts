/** Packed npm-bin boundary proof for the foreground test supervisor. */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

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

/** Pack and extract the exact checkout into npm's Unix bin layout. */
beforeAll(() => {
  const staging = path.join(TEST_ROOT, "pack");
  fs.mkdirSync(staging, { recursive: true });
  const packed = boundedSpawnSync({
    label: "npm pack for lisa-test-run bin proof",
    command: "npm",
    args: ["pack", "--ignore-scripts", "--pack-destination", staging],
    baseMs: 30_000,
    cwd: REPO_ROOT,
  });
  expect(packed.status, packed.stderr).toBe(0);
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

afterAll(() => {
  fs.rmSync(TEST_ROOT, { force: true, recursive: true });
});

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
    LISA_TEST_SCRATCH_ROOT: base,
    LISA_TEST_SCRATCH_SUITE: "packed-bin",
    LISA_PACKED_BIN_MARKER: marker,
    LISA_PACKED_BIN_MODE: mode,
    TMPDIR: base,
    TMP: base,
    TEMP: base,
  };
  const args = ["--", process.execPath, PAYLOAD];
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
    it.each([
      ["exit", 23, null],
      ["signal", null, "SIGTERM"],
    ] as const)(
      "runs its payload marker and preserves %s outcome",
      (mode, expectedStatus, expectedSignal) => {
        const run = runPacked(mode);
        expect(fs.readFileSync(run.marker, "utf8")).toBe("ran");
        expect(run.result.status).toBe(expectedStatus);
        expect(run.result.signal).toBe(expectedSignal);
        expect(run.result.error).toBeUndefined();
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
