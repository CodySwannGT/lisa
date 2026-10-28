/**
 * @file history-secret-provision-errors.test.ts
 * @description Provisioning phase refusals expose authored guidance without raw errors.
 * @module tests/history-secrets
 */
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();
const scripts = resolve(
  import.meta.dirname,
  "../../../all/copy-overwrite/scripts"
);
const cases = [
  [
    "fetch",
    "Pinned scanner download setup failed. Restore access to the official release and retry provisioning.",
  ],
  [
    "body",
    "Pinned scanner archive transfer failed. Restore access to the official release and retry provisioning.",
  ],
] as const;

/**
 * Inject only test transport failures before the real provisioning module loads.
 * @param folder - Owned disposable fixture directory
 * @param phase - Exact rejecting transport phase
 * @param canary - Untrusted diagnostic that must remain private
 * @returns Preloader and invocation trace paths
 */
function transportFixture(folder: string, phase: string, canary: string) {
  const preload = join(folder, "transport.mjs");
  const trace = join(folder, "calls.jsonl");
  writeFileSync(trace, "");
  writeFileSync(
    preload,
    `
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync } from "node:fs";
const record = value => appendFileSync(${JSON.stringify(trace)}, JSON.stringify(value) + "\\n");
childProcess.spawnSync = () => { record("spawn"); throw new Error(${JSON.stringify(canary)}); };
syncBuiltinESMExports();
globalThis.fetch = async () => {
  record("fetch");
  if (${JSON.stringify(phase)} === "fetch") throw new Error(${JSON.stringify(canary)});
  return { ok: true, arrayBuffer: async () => {
    record("body");
    throw new Error(${JSON.stringify(canary)});
  } };
};
`
  );
  return { preload, trace };
}

describe("history scanner provisioning phase redaction", () => {
  it.each(cases)(
    "classifies %s rejection without exposing vendor diagnostics",
    (phase, guidance) => {
      const folder = mkdtempSync(join(tmpdir(), "history-provision-errors-"));
      const canary = `private-canary-${randomBytes(24).toString("hex")}`;
      try {
        const { preload, trace } = transportFixture(folder, phase, canary);
        const destination = join(folder, "scanner");
        const direct = boundedSpawnSync({
          label: "actual provisioning module rejection",
          command: process.execPath,
          args: [
            "--import",
            preload,
            "--input-type=module",
            "-e",
            `
const { provisionScanner } = await import(${JSON.stringify(pathToFileURL(join(scripts, "lib/history-secret-scanner.mjs")).href)});
const { HistorySecretError } = await import(${JSON.stringify(pathToFileURL(join(scripts, "lib/history-secret-git.mjs")).href)});
try { await provisionScanner(${JSON.stringify(destination)}); process.exitCode = 9; }
catch (error) { console.log(JSON.stringify({ authored: error instanceof HistorySecretError, message: error.message })); process.exitCode = 1; }
`,
          ],
          cwd: folder,
          baseMs: 30000,
        });
        const directCalls = readFileSync(trace, "utf8");
        writeFileSync(trace, "");
        const cli = boundedSpawnSync({
          label: "actual provisioning CLI rejection",
          command: process.execPath,
          args: [
            "--import",
            preload,
            join(scripts, "lisa-history-secrets.mjs"),
            "provision",
            destination,
          ],
          cwd: folder,
          baseMs: 30000,
        });
        const cliCalls = readFileSync(trace, "utf8");
        console.log(
          `PROVISION_PHASE_OBSERVATION ${JSON.stringify({
            phase,
            direct: {
              status: direct.status,
              stdout: String(direct.stdout),
              stderr: String(direct.stderr),
            },
            cli: {
              status: cli.status,
              stdout: String(cli.stdout),
              stderr: String(cli.stderr),
            },
            directCalls,
            cliCalls,
            destinationExists: existsSync(destination),
            canaryAbsent: ![
              direct.stdout,
              direct.stderr,
              cli.stdout,
              cli.stderr,
            ].some(value => String(value).includes(canary)),
          })}`
        );
        expect(direct.status).toBe(1);
        expect(cli.status).toBe(1);
        expect(JSON.parse(String(direct.stdout))).toEqual({
          authored: true,
          message: guidance,
        });
        expect(String(cli.stderr).trim()).toBe(guidance);
        expect(String(cli.stdout)).toBe("");
        for (const output of [
          direct.stdout,
          direct.stderr,
          cli.stdout,
          cli.stderr,
        ])
          expect(String(output)).not.toContain(canary);
        const expectedCalls = (
          phase === "fetch" ? ["fetch"] : ["fetch", "body"]
        )
          .map(value => `${JSON.stringify(value)}\n`)
          .join("");
        expect(directCalls).toBe(expectedCalls);
        expect(cliCalls).toBe(expectedCalls);
        expect(existsSync(destination)).toBe(false);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    }
  );
});
