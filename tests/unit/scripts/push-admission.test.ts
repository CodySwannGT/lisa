/**
 * The push gate's admission wrapper (CodySwannGT/lisa#4596): which steps it
 * routes through `lisa admit`, how it quotes them, and that it changes nothing
 * while `pushGate.admission` is off.
 * @module tests/unit/scripts/push-admission
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ADMITTED_GATES,
  admissionEnabled,
  admittedCommand,
  lisaCliPrefix,
  shellQuote,
  withAdmission,
} from "../../../all/copy-overwrite/scripts/lib/push-admission.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * A private project root.
 * @returns Path
 */
function root(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-test-"));
  roots.push(dir);
  return dir;
}

/**
 * An executor that records what it was asked to run.
 * @returns The executor and its calls
 */
function recorder(): {
  exec: (command: string, gate?: { id?: string }) => { code: number };
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    exec: command => {
      calls.push(command);
      return { code: 0 };
    },
  };
}

describe("admissionEnabled", () => {
  it("is off by default and on only for true", () => {
    expect(admissionEnabled(undefined)).toBe(false);
    expect(admissionEnabled({})).toBe(false);
    expect(admissionEnabled({ pushGate: { buildOnce: true } })).toBe(false);
    expect(admissionEnabled({ pushGate: { admission: false } })).toBe(false);
    expect(admissionEnabled({ pushGate: { admission: true } })).toBe(true);
  });

  it("refuses a wrong type instead of defaulting it", () => {
    expect(() => admissionEnabled({ pushGate: { admission: "yes" } })).toThrow(
      /pushGate\.admission is "yes"/u
    );
    expect(() => admissionEnabled({ pushGate: [] })).toThrow(/pushGate is/u);
  });
});

describe("withAdmission", () => {
  it("returns the executor untouched when the switch is off", () => {
    const { exec } = recorder();
    expect(withAdmission(exec, { enabled: false })).toBe(exec);
  });

  it("wraps slow lint, typecheck and build-once, and nothing else", () => {
    const { exec, calls } = recorder();
    const admitted = withAdmission(exec, {
      enabled: true,
      platform: "darwin",
      cli: () => "node dist/index.js",
    });
    admitted("bun run lint:slow", { id: "code-style-slow" });
    admitted("bun run typecheck", { id: "type-correctness" });
    admitted("bun run build", { id: "build-once" });
    admitted("bun run test:cov:unit:push", { id: "unit-tests" });
    expect(calls).toEqual([
      "node dist/index.js admit --workers 2 -- 'bun run lint:slow'",
      "node dist/index.js admit --workers 1 -- 'bun run typecheck'",
      "node dist/index.js admit --workers 2 -- 'bun run build'",
      "bun run test:cov:unit:push",
    ]);
    expect(
      Object.keys(ADMITTED_GATES).sort((a, b) => a.localeCompare(b))
    ).toEqual(["build-once", "code-style-slow", "type-correctness"]);
  });

  it("says why it cannot admit, and runs the step, on Windows and without a CLI", () => {
    const lines: string[] = [];
    const { exec } = recorder();
    expect(
      withAdmission(exec, {
        enabled: true,
        platform: "win32",
        out: line => lines.push(line),
      })
    ).toBe(exec);
    expect(
      withAdmission(exec, {
        enabled: true,
        platform: "linux",
        cli: () => null,
        out: line => lines.push(line),
      })
    ).toBe(exec);
    expect(lines.join("\n")).toMatch(/Windows/u);
    expect(lines.join("\n")).toMatch(/no Lisa CLI is installed/u);
  });
});

describe("shellQuote", () => {
  it("survives a single quote through a real shell", () => {
    const text = `echo 'it''s' "fine"`;
    expect(
      execFileSync("sh", ["-c", `printf %s ${shellQuote(text)}`], {
        encoding: "utf8",
      })
    ).toBe(text);
    expect(admittedCommand("lisa", 3, "a b")).toBe(
      "lisa admit --workers 3 -- 'a b'"
    );
  });
});

describe("lisaCliPrefix", () => {
  it("uses Lisa's own build inside Lisa", () => {
    const dir = root();
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "@codyswann/lisa" })
    );
    mkdirSync(path.join(dir, "dist"));
    writeFileSync(path.join(dir, "dist", "index.js"), "");
    expect(lisaCliPrefix(dir)).toBe("node dist/index.js");
  });

  it("uses the installed binary in a host, and null when there is none", () => {
    const dir = root();
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "host" })
    );
    expect(lisaCliPrefix(dir)).toBeNull();
    mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
    writeFileSync(path.join(dir, "node_modules", ".bin", "lisa"), "");
    expect(lisaCliPrefix(dir)).toBe("node_modules/.bin/lisa");
  });
});
