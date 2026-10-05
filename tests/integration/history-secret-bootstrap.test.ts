/**
 * @file history-secret-bootstrap.test.ts
 * @description Damaged managed bootstrap stays redacted and preserves actual stdin fan-out.
 * @module tests/history-secrets
 */
import { randomBytes } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
useIoLatencyBudget();
const root = resolve(import.meta.dirname, "../..");
const sourceScripts = join(root, "all/copy-overwrite/scripts");
const zero = "0".repeat(40);
const NO_HISTORY = "No introduced history. Scanner was not run.";
const TRACE_INPUT = "trace-input";
const TRACE_ARGS = "trace-args";
const SCANNER_ENTRY = "lisa-history-secrets.mjs";
const WRAPPER_ENTRY = "lisa-rails-prepush.mjs";
const input = `(delete) ${zero} refs/heads/fixture ${"a".repeat(40)}\n`;
const hook = load(
  readFileSync(join(root, "rails/copy-overwrite/lefthook.yml"), "utf8")
) as {
  "pre-push": { commands: { "work-item": { run: string } } };
};
/**
 * Run the emitted hook bootstrap with its original stdin and remote argument.
 * @param cwd - Disposable fixture checkout
 * @returns Terminal hook result with privately captured output
 */
const runHook = (cwd: string) =>
  boundedSpawnSync({
    label: "actual managed push bootstrap",
    command: "bash",
    args: [
      "-c",
      hook["pre-push"].commands["work-item"].run.replace("{1}", "origin"),
    ],
    cwd,
    input,
    baseMs: 30000,
  });
describe("managed history bootstrap redaction", () => {
  it("withholds absent or noncallable invocation exports and thrown guard errors", () => {
    const value = randomBytes(32).toString("hex");
    const cwd = mkdtempSync(join(tmpdir(), `history-${value}-`));
    try {
      for (const source of [
        "export {};",
        "export const invokedAsScript = 1;",
        `export const invokedAsScript = () => { throw new Error(${JSON.stringify(value)}); };`,
      ]) {
        cpSync(sourceScripts, join(cwd, "scripts"), { recursive: true });
        writeFileSync(join(cwd, "scripts/lib/invoked-as-script.mjs"), source, {
          mode: 0o600,
        });
        writeFileSync(
          join(cwd, "scripts/lisa-work-item.mjs"),
          "import{readFileSync,writeFileSync}from'node:fs';writeFileSync('trace-input',readFileSync(0),{mode:0o600});writeFileSync('trace-args',JSON.stringify(process.argv.slice(2)),{mode:0o600});",
          { mode: 0o600 }
        );
        for (const [name, directArg, importedCall] of [
          [
            SCANNER_ENTRY,
            "pre-push",
            'await main(["pre-push"], process.cwd(), "")',
          ],
          [WRAPPER_ENTRY, "origin", 'await main(["origin"])'],
        ] as const) {
          const entry = join(cwd, "scripts", name);
          for (const { args, verifyFanOut } of [
            { args: [entry, directArg], verifyFanOut: false },
            {
              args: [
                "--input-type=module",
                "-e",
                `const { main } = await import(process.argv[1]); process.exitCode = ${importedCall};`,
                entry,
              ],
              verifyFanOut: name === WRAPPER_ENTRY,
            },
          ]) {
            rmSync(join(cwd, TRACE_INPUT), { force: true });
            rmSync(join(cwd, TRACE_ARGS), { force: true });
            const result = boundedSpawnSync({
              label: "actual invalid invocation export",
              command: process.execPath,
              args,
              cwd,
              input,
              baseMs: 30000,
            });
            expect(result.status).toBe(1);
            expect(String(result.stdout) + String(result.stderr)).not.toContain(
              value
            );
            expect(String(result.stderr)).toContain("full Lisa apply");
            if (verifyFanOut) {
              expect(readFileSync(join(cwd, TRACE_INPUT), "utf8")).toBe(input);
              expect(
                JSON.parse(readFileSync(join(cwd, TRACE_ARGS), "utf8"))
              ).toEqual(["validate-push", "origin"]);
              expect(String(result.stderr)).toContain(
                "Required history scanning failed."
              );
            }
          }
        }
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  it("executes the emitted CLI through symlinks with either Node entry mode", () => {
    const cwd = mkdtempSync(join(tmpdir(), "history-bootstrap-link-"));
    try {
      cpSync(sourceScripts, join(cwd, "scripts"), {
        recursive: true,
      });
      expect(
        boundedSpawnSync({
          label: "symlink Git fixture",
          command: "git",
          args: ["init", "-q"],
          cwd,
          baseMs: 30000,
        }).status
      ).toBe(0);
      const link = join(cwd, "scripts/history-alias.mjs");
      symlinkSync(SCANNER_ENTRY, link);
      for (const flags of [[], ["--preserve-symlinks-main"]]) {
        const result = boundedSpawnSync({
          label: "actual symlink scanner bootstrap",
          command: process.execPath,
          args: [...flags, link, "pre-push"],
          cwd,
          input: "",
          baseMs: 30000,
        });
        expect(result.status).toBe(0);
        expect(String(result.stdout)).toContain(NO_HISTORY);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  it("attempts traceability and scanning when policy import or traceability fails", () => {
    const value = randomBytes(32).toString("hex");
    const cwd = mkdtempSync(join(tmpdir(), `history-${value}-`));
    try {
      cpSync(sourceScripts, join(cwd, "scripts"), {
        recursive: true,
      });
      expect(
        boundedSpawnSync({
          label: "bootstrap Git fixture",
          command: "git",
          args: ["init", "-q"],
          cwd,
          baseMs: 30000,
        }).status
      ).toBe(0);
      writeFileSync(
        join(cwd, "scripts/lisa-work-item.mjs"),
        `import{readFileSync,writeFileSync}from'node:fs';writeFileSync('trace-input',readFileSync(0),{mode:0o600});writeFileSync('trace-args',JSON.stringify(process.argv.slice(2)),{mode:0o600});console.error(${JSON.stringify(value)});process.exitCode=1;`,
        { mode: 0o600 }
      );
      rmSync(join(cwd, "scripts/lib/history-secret-policy.mjs"));
      const result = runHook(cwd);
      expect(result.status).toBe(1);
      expect(String(result.stdout)).toContain(NO_HISTORY);
      expect(String(result.stdout) + String(result.stderr)).not.toContain(
        value
      );
      expect(readFileSync(join(cwd, TRACE_INPUT), "utf8")).toBe(input);
      expect(JSON.parse(readFileSync(join(cwd, TRACE_ARGS), "utf8"))).toEqual([
        "validate-push",
        "origin",
      ]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  it("withholds missing/corrupt helper, entrypoint and wrapper bootstrap errors", () => {
    const value = randomBytes(32).toString("hex");
    const cwd = mkdtempSync(join(tmpdir(), `history-${value}-`));
    try {
      for (const damaged of [
        "lib/invoked-as-script.mjs",
        "lib/history-secret-scanner.mjs",
        SCANNER_ENTRY,
        WRAPPER_ENTRY,
      ]) {
        for (const corruption of [false, true]) {
          cpSync(sourceScripts, join(cwd, "scripts"), { recursive: true });
          const path = join(cwd, "scripts", damaged);
          if (corruption)
            writeFileSync(path, `throw new Error(${JSON.stringify(value)});`, {
              mode: 0o600,
            });
          else rmSync(path);
          const result = runHook(cwd);
          expect(result.status).toBe(1);
          expect(String(result.stdout) + String(result.stderr)).not.toContain(
            value
          );
          expect(String(result.stderr)).toMatch(/Repair|full Lisa apply/u);
        }
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
