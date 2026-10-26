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
  browserStderrMetadata,
  finishQualification,
} from "../../fixtures/npm-update-hosted-runtime/observations.mjs";
import {
  recordPackageFailure,
  packageVersionObservation,
} from "../../fixtures/npm-update-hosted-runtime/package-observations.mjs";
import {
  browser,
  browserControl,
} from "../../fixtures/npm-update-hosted-runtime/components.mjs";

useIoLatencyBudget();
const SUMMARY = "summary.json";
const CAPTURE_FILE = "capture-0-stdout";
const STAGE = "fixture-git";
const BROWSER_CONSUMER = "browser-consumer";
const CONTROL_STAGE = "browser-control";
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
  it.each(["update", "install"])(
    "captures the original apt-%s refusal without exposing private native output",
    async operation => {
      await fixture(async root => {
        const tools =
          await import("../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs");
        const { runProcess } =
          await import("../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs");
        const records: object[] = [];
        let original: unknown;
        try {
          await tools.installRailsPackages(
            async (_command: string, args: string[]) => {
              if (args.includes(operation))
                return runProcess(
                  process.execPath,
                  [
                    "-e",
                    "process.stdout.write('private-package-output'); process.stderr.write('private-mirror-config'); process.exitCode=100;",
                  ],
                  {
                    cwd: root,
                    env: { PATH: NATIVE_PATH },
                    timeout: 2000,
                    maximum: 4096,
                  }
                );
              return {
                code: 0,
                stdout: Buffer.alloc(0),
                stderr: Buffer.alloc(0),
              };
            },
            true
          );
        } catch (error) {
          original = error;
        }
        expect(original).toMatchObject({ code: 100 });
        const phase = tools.railsPackageFailurePhase(original);
        expect(phase).toBe(`apt-${operation}`);
        recordPackageFailure(root, records, phase, original as Error);
        expect(records).toEqual([
          expect.objectContaining({
            stage: `apt-${operation}`,
            status: 100,
            elapsedMs: null,
            nativeFailure: expect.stringContaining("native=exit"),
            stdoutSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            stderrSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          }),
        ]);
        expect(readFileSync(join(root, "capture-0-stdout"), "utf8")).toBe(
          "private-package-output"
        );
        expect(readFileSync(join(root, "capture-0-stderr"), "utf8")).toBe(
          "private-mirror-config"
        );
        expect(JSON.stringify(records)).not.toContain("private-");
        expect(JSON.stringify(records)).not.toContain(root);
      });
    }
  );
  it("only publishes validated fixed-name package versions and distinguishes absence from read failure", () => {
    expect(
      packageVersionObservation("libx11-6", {
        code: 0,
        stdout: Buffer.from("libx11-6:amd64\t2:1.8.7-1ubuntu0.1\n"),
      })
    ).toEqual({
      name: "libx11-6",
      status: "installed",
      version: "2:1.8.7-1ubuntu0.1",
    });
    expect(
      packageVersionObservation("libx11-xcb1", {
        code: 1,
        nativeCompleted: true,
        stdout: Buffer.alloc(0),
      })
    ).toEqual({ name: "libx11-xcb1", status: "absent" });
    for (const result of [
      { code: 2, stdout: Buffer.alloc(0) },
      { code: 1, nativeCompleted: false, stdout: Buffer.alloc(0) },
      { code: null, stdout: Buffer.alloc(0) },
      {
        code: 0,
        stdout: Buffer.from(
          "libx11-6\tprivate mirror https://private/credential\n"
        ),
      },
      { code: 0, stdout: Buffer.from("other-package\t1.2.3\n") },
      { code: 0, stdout: Buffer.from(`libx11-6\t1${"a".repeat(256)}\n`) },
    ])
      expect(packageVersionObservation("libx11-6", result)).toEqual({
        name: "libx11-6",
        status: "unavailable",
      });
    expect(() =>
      packageVersionObservation("private-name", { code: 0 })
    ).toThrow("unknown pre-state package");
  });
  it("refuses a foreign private package capture and rejects unknown phases before publication", async () => {
    await fixture(root => {
      const records: object[] = [];
      const failure = Object.assign(new Error("private package refusal"), {
        code: 100,
        stdout: Buffer.from("private replacement"),
        stderr: Buffer.alloc(0),
      });
      writeFileSync(join(root, CAPTURE_FILE), "foreign capture", {
        mode: 0o600,
        flag: "wx",
      });
      expect(() =>
        recordPackageFailure(root, records, "apt-install", failure)
      ).toThrow(expect.objectContaining({ code: "EEXIST" }));
      expect(readFileSync(join(root, CAPTURE_FILE), "utf8")).toBe(
        "foreign capture"
      );
      expect(records).toEqual([
        expect.objectContaining({
          stage: "apt-install",
          status: 100,
          captureFailure: expect.any(Array),
        }),
      ]);
      expect(JSON.stringify(records)).not.toContain("private replacement");
      expect(() =>
        recordPackageFailure(root, records, "private-phase", failure)
      ).toThrow("unknown package failure phase");
      expect(records).toHaveLength(1);
    });
  });
  it("a preservation success cannot hide an operation failure, owned-root survivor or cleanup refusal", () => {
    for (const change of [
      { ownedRootAbsent: false },
      { cleanupFailures: [{}] },
      { failure: new Error("private failure") },
    ]) {
      const summary = {
        ownedRootAbsent: true,
        foreignResourcesPreserved: true,
        cleanupFailures: [] as object[],
        ...change,
        nativeSuccess: true,
      };
      finishQualification(
        summary,
        "failure" in change ? change.failure : undefined
      );
      expect(summary.nativeSuccess).toBe(false);
      expect(JSON.stringify(summary)).not.toContain("private failure");
    }
  });
  it("caps vendor fingerprints and ignores unknown or malformed private log fields", () => {
    const prefix = "[1:2:1008/120000.000:ERROR:";
    const secret = "private credential /private/candidate/path";
    const lines = Array.from(
      { length: 20 },
      (_, index) =>
        `${prefix}headless_command_handler.cc:378] ${index === 19 ? "Abnormal renderer termination. " : ""}${secret}`
    );
    const result = browserStderrMetadata(
      Buffer.from(
        [
          ...lines,
          `${prefix}private-input.cc:1] ${secret}`,
          `${prefix}headless_command_handler.cc:0] ${secret}`,
          secret,
        ].join("\n")
      )
    );
    expect(result).toMatchObject({
      structuredLineCount: 21,
      ignoredLineCount: 1,
      truncated: true,
    });
    expect(result.records).toHaveLength(16);
    expect(result.records.at(-1)).toMatchObject({
      kind: "renderer-terminated",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("private-input.cc");
  });
  it("requests bounded DOM capture while retaining internal-URL and sandbox requirements", async () => {
    await fixture(async root => {
      // This native synthetic consumer models Chrome's documented flag contract; it does not qualify Chrome or Ubuntu.
      const command = join(root, BROWSER_CONSUMER);
      writeFileSync(
        command,
        `#!${process.execPath}\nconst args=process.argv.slice(2);\nif(!args.includes('--allow-chrome-scheme-url')) process.exit(17);\nif(!args.includes('--headless=new') || !args.includes('--dump-dom') || args.at(-1)!=='chrome://sandbox' || args.includes('--no-sandbox')) process.exit(18);\nif(!args.includes('--timeout=5000')) process.exit(19);\nprocess.stdout.write('You are adequately sandboxed.<tr><td>Layer 1 Sandbox</td><td>SUID</td></tr>');\n`,
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
  it("captures an independent blank-page diagnostic without certifying the sandbox", async () => {
    await fixture(async root => {
      const command = join(root, BROWSER_CONSUMER);
      writeFileSync(
        command,
        `#!${process.execPath}\nconst args=process.argv.slice(2);\nif(!args.includes('--headless=new') || !args.includes('--dump-dom') || !args.includes('--timeout=5000') || args.at(-1)!=='about:blank' || args.includes('--no-sandbox')) process.exit(17);\nprocess.stdout.write('<html><head></head><body></body></html>');\n`,
        { flag: "wx", mode: 0o700 }
      );
      const records: object[] = [];
      const native = nativeRecorder(root, Date.now() + 60000, records);
      await expect(
        browserControl(
          root,
          { cwd: root, env: { CHROME_BINARY: command } },
          native
        )
      ).resolves.toEqual({ diagnosticOnly: true, nativeDomVerified: true });
      expect(records).toEqual([
        expect.objectContaining({ stage: CONTROL_STAGE, status: 0 }),
      ]);
    });
  });
  it("retains a blank-page diagnostic refusal rather than certifying browser success", async () => {
    await fixture(async root => {
      const command = join(root, BROWSER_CONSUMER);
      writeFileSync(command, `#!${process.execPath}\nprocess.exit(17);\n`, {
        flag: "wx",
        mode: 0o700,
      });
      const records: object[] = [];
      const native = nativeRecorder(root, Date.now() + 60000, records);
      await expect(
        browserControl(
          root,
          { cwd: root, env: { CHROME_BINARY: command } },
          native
        )
      ).rejects.toMatchObject({ code: 17 });
      expect(records).toEqual([
        expect.objectContaining({ stage: CONTROL_STAGE, status: 17 }),
      ]);
    });
  });
  it.each(["browser", CONTROL_STAGE])(
    "bounds a real hanging %s child and retains remaining phase time for cleanup observations",
    async stage => {
      await fixture(async root => {
        const records: object[] = [];
        const deadline = Date.now() + 60000;
        const native = nativeRecorder(root, deadline, records);
        const executable =
          stage === CONTROL_STAGE
            ? join(root, "native-executable-alias")
            : process.execPath;
        if (stage === CONTROL_STAGE) symlinkSync(process.execPath, executable);
        await expect(
          native(stage, root, {}, executable, [
            "-e",
            "process.stdout.write(String(process.pid)); process.stderr.write('[1:2:1008/120000.000:ERROR:headless_command_handler.cc:378] Abnormal renderer termination. private credential /private/candidate/path\\n'); setTimeout(() => {}, 12000);",
          ])
        ).rejects.toMatchObject({ code: null });
        const pid = Number(readFileSync(join(root, CAPTURE_FILE), "utf8"));
        expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
        expect(() => process.kill(pid, 0)).toThrow(
          expect.objectContaining({ code: "ESRCH" })
        );
        expect(Date.now()).toBeLessThan(deadline);
        if (process.platform === "linux") {
          const observed = records[0] as {
            browserProcesses: {
              supported: boolean;
              samples: { rows?: object[] }[];
            };
          };
          expect(observed.browserProcesses.supported).toBe(true);
          expect(
            observed.browserProcesses.samples.some(
              sample => (sample.rows?.length ?? 0) > 0
            )
          ).toBe(true);
          for (const sample of observed.browserProcesses.samples)
            for (const row of sample.rows ?? [])
              expect(
                Object.keys(row).sort((a, b) => a.localeCompare(b))
              ).toEqual([
                "noNewPrivileges",
                "role",
                "seccomp",
                "state",
                "wait",
              ]);
          expect(JSON.stringify(observed.browserProcesses)).not.toContain(
            process.execPath
          );
          expect(JSON.stringify(observed.browserProcesses)).not.toContain(
            executable
          );
        }
        await expect(
          native(STAGE, root, {}, process.execPath, ["-e", ""])
        ).resolves.toMatchObject({ code: 0 });
        expect(records).toEqual([
          expect.objectContaining({
            stage,
            status: null,
            nativeFailure: expect.stringContaining("native=deadline"),
            browserStderr: expect.objectContaining({
              structuredLineCount: 1,
              records: [
                expect.objectContaining({
                  source: "headless_command_handler.cc",
                  kind: "renderer-terminated",
                }),
              ],
            }),
          }),
          expect.objectContaining({ stage: STAGE, status: 0 }),
        ]);
        expect(JSON.stringify(records)).not.toContain("private credential");
        expect(JSON.stringify(records)).not.toContain(
          "/private/candidate/path"
        );
      });
    }
  );
  it.each([
    [
      "You are adequately sandboxed.You are NOT adequately sandboxed.<tr><td>Layer 1 Sandbox</td><td>SUID</td></tr>",
      "native browser sandbox is unavailable",
    ],
    [
      "<td>SUID Sandbox</td><td>Yes</td>",
      "native browser sandbox is unavailable",
    ],
    [
      "You are adequately sandboxed.<td>SUID Sandbox</td><td>No</td>",
      "native browser SUID sandbox is unavailable",
    ],
  ])(
    "refuses incomplete captured sandbox evidence: %s",
    async (html, reason) => {
      await fixture(async root => {
        const command = join(root, BROWSER_CONSUMER);
        writeFileSync(
          command,
          `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(html)});\n`,
          { flag: "wx", mode: 0o600 }
        );
        chmodSync(command, 0o700);
        const records: object[] = [];
        const native = nativeRecorder(root, Date.now() + 60000, records);
        await expect(
          browser(root, { cwd: root, env: { CHROME_BINARY: command } }, native)
        ).rejects.toThrow(reason);
        expect(records).toEqual([
          expect.objectContaining({ stage: "browser", status: 0 }),
        ]);
      });
    }
  );
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
