/** Real harmless child/file controls qualify private diagnostics, not provider or Ubuntu acceptance. */
import { describe, expect, it } from "vitest";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { createSupervisedUnixFixture } from "../../helpers/supervised-unix-fixture.js";
import { SCRATCH_SUPERVISION_LEASE_ENV } from "../../../src/configs/vitest/scratch-supervision.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  privateResult,
  nativeRecorder,
  failureMetadata,
  hookWitness,
} from "../../fixtures/npm-update-hosted-runtime/observations.mjs";
import { browser } from "../../fixtures/npm-update-hosted-runtime/components.mjs";

useIoLatencyBudget();
const SUMMARY = "summary.json";
const CAPTURE_FILE = "capture-0-stdout";
const STAGE = "fixture-git";
const SHELL = "/bin/sh";
const NATIVE_PATH = "/usr/bin:/bin";

function fixture(operation: (root: string) => Promise<void> | void) {
  const owned = createSupervisedUnixFixture(
    "hook-reader.sock",
    process.env[SCRATCH_SUPERVISION_LEASE_ENV]
  );
  return Promise.resolve()
    .then(() => operation(owned.root))
    .finally(() => owned.close());
}

describe("closed runtime qualification diagnostics", () => {
  it("passes the required internal-URL flag to a real command consumer without changing sandbox requirements", async () => {
    await fixture(async root => {
      // This native synthetic consumer models Chrome's documented flag contract; it does not qualify Chrome or Ubuntu.
      const command = join(root, "browser-consumer");
      writeFileSync(
        command,
        `#!${process.execPath}\nconst args=process.argv.slice(2);\nif(!args.includes('--allow-chrome-scheme-url')) process.exit(17);\nif(!args.includes('--headless=new') || !args.includes('--dump-dom') || args.at(-1)!=='chrome://sandbox' || args.includes('--no-sandbox')) process.exit(18);\nprocess.stdout.write('You are adequately sandboxed.<td>SUID Sandbox</td><td>Yes</td>');\n`,
        { flag: "wx", mode: 0o600 }
      );
      chmodSync(command, 0o700);
      const records: object[] = [];
      const native = nativeRecorder(root, Date.now() + 60000, records);
      await expect(
        browser(root, { cwd: root, env: { CHROME_BINARY: command } }, native)
      ).resolves.toEqual({
        nativeSandboxVerified: true,
        suidSandboxActive: true,
        driverSessionVerified: false,
      });
      expect(records).toEqual([
        expect.objectContaining({ stage: "browser", status: 0 }),
      ]);
    });
  });
  it("bounds a real hanging browser-stage child and retains remaining phase time for cleanup observations", async () => {
    await fixture(async root => {
      const records: object[] = [];
      const deadline = Date.now() + 60000;
      const native = nativeRecorder(root, deadline, records);
      await expect(
        native("browser", root, {}, process.execPath, [
          "-e",
          "process.stdout.write(String(process.pid)); setTimeout(() => {}, 12000);",
        ])
      ).rejects.toMatchObject({ code: null });
      const pid = Number(readFileSync(join(root, CAPTURE_FILE), "utf8"));
      expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
      expect(() => process.kill(pid, 0)).toThrow(
        expect.objectContaining({ code: "ESRCH" })
      );
      expect(Date.now()).toBeLessThan(deadline);
      await expect(
        native(STAGE, root, {}, process.execPath, ["-e", ""])
      ).resolves.toMatchObject({ code: 0 });
      expect(records).toEqual([
        expect.objectContaining({ stage: "browser", status: null }),
        expect.objectContaining({ stage: STAGE, status: 0 }),
      ]);
    });
  });
  it("retains real exit17 output privately while exporting only closed status, sizes and hashes", async () => {
    await fixture(async root => {
      const records: object[] = [];
      const native = nativeRecorder(root, Date.now() + 10000, records);
      await expect(
        native(STAGE, root, { PATH: NATIVE_PATH }, SHELL, [
          "-c",
          "printf synthetic-private-capture; exit 17",
        ])
      ).rejects.toMatchObject({ code: 17 });
      const capture = readFileSync(join(root, CAPTURE_FILE), "utf8");
      expect(capture).toBe("synthetic-private-capture");
      expect(records).toEqual([
        expect.objectContaining({
          stage: STAGE,
          status: 17,
          stdoutBytes: 25,
        }),
      ]);
      expect(JSON.stringify(records)).not.toContain(
        "synthetic-private-capture"
      );
      expect(JSON.stringify(records)).not.toContain(root);
    });
  });
  it("refuses unknown stages before any native child", async () => {
    await fixture(async root => {
      const records: object[] = [];
      const native = nativeRecorder(root, Date.now() + 10000, records);
      await expect(
        native("foreign", root, {}, "/bin/true", [])
      ).rejects.toThrow("unknown qualification stage");
      expect(records).toEqual([]);
    });
  });
  it("preserves the native refusal when exclusive private capture also fails", async () => {
    await fixture(async root => {
      writeFileSync(join(root, CAPTURE_FILE), "foreign", { mode: 0o600 });
      const records: object[] = [];
      const native = nativeRecorder(root, Date.now() + 10000, records);
      await expect(
        native(STAGE, root, { PATH: NATIVE_PATH }, SHELL, [
          "-c",
          "printf owned; exit 17",
        ])
      ).rejects.toMatchObject({
        name: "AggregateError",
        cause: { code: 17 },
        errors: [
          expect.objectContaining({ code: 17 }),
          expect.objectContaining({ code: "EEXIST" }),
        ],
      });
      expect(records).toEqual([
        expect.objectContaining({ status: 17, stdoutBytes: 5 }),
      ]);
      expect(readFileSync(join(root, CAPTURE_FILE), "utf8")).toBe("foreign");
    });
  });
  it("refuses an existing or aliased result while preserving foreign bytes", async () => {
    await fixture(root => {
      const output = join(root, SUMMARY);
      writeFileSync(output, "foreign", { mode: 0o600 });
      expect(() => privateResult(output)).toThrow();
      expect(readFileSync(output, "utf8")).toBe("foreign");
      const alias = join(root, "alias.json");
      symlinkSync(output, alias);
      expect(() => privateResult(alias)).toThrow();
      expect(readFileSync(output, "utf8")).toBe("foreign");
    });
  });
  it("pins the private parent and refuses redirected publication", async () => {
    await fixture(root => {
      const parent = join(root, "report");
      const retained = join(root, "retained");
      const foreign = join(root, "foreign");
      mkdirSync(parent, { mode: 0o700 });
      mkdirSync(foreign, { mode: 0o700 });
      writeFileSync(join(foreign, SUMMARY), "foreign", { mode: 0o600 });
      const output = privateResult(join(parent, SUMMARY));
      try {
        renameSync(parent, retained);
        symlinkSync(foreign, parent);
        expect(() => output.write({ nativeSuccess: false })).toThrow(
          "qualification parent changed"
        );
        expect(readFileSync(join(foreign, SUMMARY), "utf8")).toBe("foreign");
        expect(readFileSync(join(retained, SUMMARY)).length).toBe(0);
      } finally {
        output.close();
      }
    });
  });
  it("bounded cause diagnostics omit original messages, paths and custom error properties", () => {
    const error = Object.assign(
      new Error("synthetic private data", {
        cause: new TypeError("private cause"),
      }),
      { token: "synthetic-private-token" }
    );
    const result = failureMetadata(error);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      class: "Error",
      messageSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("requires all four actual hook witnesses and least-privilege readbacks", () => {
    const rows = ["test", "queue_test", "cache_test", "cable_test"].map(
      role => ({
        role,
        physical_schema: true,
        native_rows: 1,
        administrator_read_denied: true,
      })
    );
    expect(hookWitness(rows)).toBe(true);
    expect(() => hookWitness(rows.slice(1))).toThrow();
    expect(() =>
      hookWitness(
        rows.map((row, index) =>
          index === 2 ? { ...row, administrator_read_denied: false } : row
        )
      )
    ).toThrow();
    expect(() =>
      hookWitness(rows.map(row => ({ ...row, foreign: true })))
    ).toThrow();
  });
});
