/**
 * @file history-secret-bootstrap.test.ts
 * @description Damaged shared core bootstrap fails closed with redacted paths and errors.
 * @module tests/history-secrets
 */
import { randomBytes } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
useIoLatencyBudget();
const sourceScripts = resolve(
  import.meta.dirname,
  "../../all/copy-overwrite/scripts"
);
const NO_HISTORY = "No introduced history. Scanner was not run.";
describe("shared history bootstrap redaction", () => {
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
        const entry = join(cwd, "scripts/lisa-history-secrets.mjs");
        for (const args of [
          [entry, "pre-push"],
          [
            "--input-type=module",
            "-e",
            'const { main } = await import(process.argv[1]); process.exitCode = await main(["pre-push"], process.cwd(), "");',
            entry,
          ],
        ]) {
          const result = boundedSpawnSync({
            label: "actual invalid invocation export",
            command: process.execPath,
            args,
            cwd,
            input: "",
            baseMs: 30000,
          });
          expect(result.status).toBe(1);
          expect(String(result.stdout) + String(result.stderr)).not.toContain(
            value
          );
          expect(String(result.stderr)).toContain("full Lisa apply");
        }
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  it("explicitly refuses unavailable package and Rails qualification", () => {
    for (const option of ["--package", "--lefthook"]) {
      const result = boundedSpawnSync({
        label: "unavailable route journey",
        command: process.execPath,
        args: [
          resolve(
            import.meta.dirname,
            "../fixtures/git-history-secrets/journey.mjs"
          ),
          option,
          "unavailable-qualification",
        ],
        cwd: tmpdir(),
        baseMs: 30000,
      });
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain(
        "this journey qualifies shared core source only"
      );
    }
  });
  it("executes the emitted CLI through symlinks with either Node entry mode", () => {
    const cwd = mkdtempSync(join(tmpdir(), "history-bootstrap-link-"));
    try {
      cpSync(sourceScripts, join(cwd, "scripts"), { recursive: true });
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
      symlinkSync("lisa-history-secrets.mjs", link);
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
  it("withholds missing/corrupt core helper bootstrap errors", () => {
    const value = randomBytes(32).toString("hex");
    const cwd = mkdtempSync(join(tmpdir(), `history-${value}-`));
    try {
      for (const damaged of [
        "lib/invoked-as-script.mjs",
        "lib/history-secret-git.mjs",
        "lib/history-secret-scanner.mjs",
      ]) {
        for (const corruption of [false, true]) {
          cpSync(sourceScripts, join(cwd, "scripts"), { recursive: true });
          const path = join(cwd, "scripts", damaged);
          if (corruption)
            writeFileSync(path, `throw new Error(${JSON.stringify(value)});`, {
              mode: 0o600,
            });
          else rmSync(path);
          const result = boundedSpawnSync({
            label: "actual damaged scanner bootstrap",
            command: process.execPath,
            args: [join(cwd, "scripts/lisa-history-secrets.mjs"), "pre-push"],
            cwd,
            input: "",
            baseMs: 30000,
          });
          expect(result.status).toBe(1);
          expect(String(result.stdout) + String(result.stderr)).not.toContain(
            value
          );
          expect(String(result.stderr)).toContain("full Lisa apply");
        }
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
