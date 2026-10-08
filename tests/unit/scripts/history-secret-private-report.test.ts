/**
 * @file history-secret-private-report.test.ts
 * @description Native transport and safe predicate controls; vendor proof is separate.
 * @module tests/history-secrets
 */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomInt } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as scanner from "../../../all/copy-overwrite/scripts/lib/history-secret-scanner.mjs";
import * as witness from "../../fixtures/git-history-secrets/report-mode.mjs";
import * as fixtureHarness from "../../fixtures/git-history-secrets/harness.mjs";
import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
useIoLatencyBudget();
vi.mock("node:crypto", async importOriginal => ({
  ...(await importOriginal<typeof import("node:crypto")>()),
  randomBytes: (length: number) => Buffer.alloc(length),
  randomInt: vi.fn(() => 0),
}));
const root = resolve(import.meta.dirname, "../../..");
const scannerPath = join(
  root,
  "all/copy-overwrite/scripts/lib/history-secret-scanner.mjs"
);
const identity = {
  scannerVersion: "8.30.1",
  scannerSha256: "a".repeat(64),
  sourceSha256: "b".repeat(64),
  archiveSha256: null,
};
const observe = (report: string, values: string[]) => {
  const fn = Reflect.get(witness, "observeReport") as (
    path: string,
    values: string[]
  ) => Record<string, unknown>;
  expect(typeof fn).toBe("function");
  return fn(report, values);
};

describe("dedicated scanner invocation native transport", () => {
  it.each(["dead", "feed"])(
    "regenerates a balanced nonce containing the default vendor stopword %s",
    word => {
      const original = "0123456789abcdef".repeat(4).split("");
      const remaining = [...original];
      for (const character of word)
        remaining.splice(remaining.indexOf(character), 1);
      const target = [...word, ...remaining];
      const state = [...original];
      for (let index = state.length - 1; index > 0; index--) {
        const selected = state.findIndex(
          (character, position) =>
            position <= index && character === target[index]
        );
        const right = state[index];
        const left = state[selected];
        if (right === undefined || left === undefined)
          throw new Error(
            "Balanced permutation index is outside the alphabet."
          );
        [state[index], state[selected]] = [left, right];
        vi.mocked(randomInt).mockImplementationOnce(() => selected);
      }
      expect(state.join("").startsWith(word)).toBe(true);
      const harness = fixtureHarness.createHarness([]);
      try {
        harness.secret();
        const value = harness.values[0];
        expect(/dead|feed/.test(value)).toBe(false);
        expect(value).toMatch(/^[a-f0-9]{64}$/);
        for (const character of new Set(original))
          expect(
            [...value].filter(symbol => symbol === character)
          ).toHaveLength(4);
      } finally {
        rmSync(harness.scratch, { recursive: true, force: true });
      }
    }
  );
  it("keeps synthetic credential entropy above the vendor floor even with repeated random bytes", () => {
    const create = Reflect.get(fixtureHarness, "createHarness") as (
      args: string[]
    ) => { scratch: string; secret: () => string; values: string[] };
    const harness = create([]);
    try {
      harness.secret();
      const value = harness.values[0] ?? "";
      const counts = new Map<string, number>();
      for (const character of value)
        counts.set(character, (counts.get(character) ?? 0) + 1);
      const entropy = [...counts.values()].reduce((sum, count) => {
        const probability = count / value.length;
        return sum - probability * Math.log2(probability);
      }, 0);
      expect(/^[a-f0-9]{64}$/.test(value)).toBe(true);
      expect(entropy).toBeGreaterThan(3.5);
    } finally {
      rmSync(harness.scratch, { recursive: true, force: true });
    }
  });
  it.each(["022", "077"])(
    "restricts only its child under caller %s and preserves argv/stdin/cwd/env",
    mask => {
      const lease = mkdtempSync(join(tmpdir(), "history-private-mask-"));
      try {
        const script = `import * as source from ${JSON.stringify(scannerPath)};
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
process.umask(parseInt(process.argv[1],8));
const before=process.umask();
const invoke=Reflect.get(source,'scannerInvocation')??((binary,argv)=>({binary,argv}));
const values=${JSON.stringify(["one two", "quote\"apostrophe'", "$(touch must-not-exist)", ""])};
const child="const fs=require('node:fs');fs.writeFileSync('private-report','private');console.log(JSON.stringify({args:process.argv.slice(1),input:fs.readFileSync(0,'utf8'),cwd:process.cwd(),marker:process.env.PROBE_MARKER,mask:process.umask()}));process.exitCode=17;";
const command=invoke(process.execPath,['-e',child,...values]);
const result=spawnSync(command.binary,command.argv,{cwd:process.cwd(),env:{...process.env,PROBE_MARKER:'kept'},input:'complete stdin\\n',encoding:'utf8',timeout:6000,maxBuffer:4096});
writeFileSync('neighbor','public');
console.log(JSON.stringify({status:result.status,signal:result.signal,error:result.error?.code??null,child:JSON.parse(result.stdout),before,after:process.umask(),reportMode:statSync('private-report').mode&511,neighborMode:statSync('neighbor').mode&511,values}));`;
        const result = boundedSpawnSync({
          label: "actual child-only scanner transport",
          command: process.execPath,
          args: ["--input-type=module", "-e", script, mask],
          cwd: lease,
          baseMs: 30000,
        });
        expect(result.status, String(result.stderr)).toBe(0);
        const actual = JSON.parse(String(result.stdout));
        expect(actual).toMatchObject({
          status: 17,
          signal: null,
          error: null,
          before: Number.parseInt(mask, 8),
          after: Number.parseInt(mask, 8),
          reportMode: 0o600,
          neighborMode: 0o666 & ~Number.parseInt(mask, 8),
        });
        expect(actual.child).toEqual({
          args: actual.values,
          input: "complete stdin\n",
          cwd: lease,
          marker: "kept",
          mask: 0o077,
        });
        expect(existsSync(join(lease, "must-not-exist"))).toBe(false);
      } finally {
        rmSync(lease, { recursive: true, force: true });
      }
    }
  );

  it("keeps launcher arguments discrete and refuses missing execution", () => {
    const invoke = Reflect.get(scanner, "scannerInvocation") as (
      binary: string,
      args: string[]
    ) => { binary: string; argv: string[] };
    expect(typeof invoke).toBe("function");
    const args = ["literal $()", "", "one two"];
    const actual = invoke("/nonexistent/private-scanner", args);
    expect(actual.argv.slice(-4)).toEqual([
      "/nonexistent/private-scanner",
      ...args,
    ]);
    expect(args).toEqual(["literal $()", "", "one two"]);
    const result = boundedSpawnSync({
      label: "actual missing scanner execution",
      command: actual.binary,
      args: actual.argv,
      cwd: root,
      baseMs: 30000,
    });
    expect(result.status).not.toBe(0);
  });
  it.each(["exit", "signal", "timeout", "capture"])(
    "preserves native %s failure semantics and caller mask",
    kind => {
      const lease = mkdtempSync(join(tmpdir(), "history-private-outcome-"));
      const outcomes: Readonly<Record<string, string>> = {
        exit: "process.exitCode=42;",
        signal: "process.kill(process.pid,'SIGTERM');",
        timeout: "setInterval(()=>{},1000);",
        capture: "process.stdout.write('x'.repeat(16384));",
      };
      const child = outcomes[kind];
      try {
        const script = `import {scannerInvocation} from ${JSON.stringify(scannerPath)};
import {spawnSync} from 'node:child_process';
import {writeFileSync,statSync} from 'node:fs';
process.umask(18); const before=process.umask();
const command=scannerInvocation(process.execPath,['-e',process.argv[1]]);
const result=spawnSync(command.binary,command.argv,{encoding:'utf8',timeout:Number(process.argv[2]),maxBuffer:1024});
writeFileSync('neighbor','public');
console.log(JSON.stringify({status:result.status,signal:result.signal,error:result.error?.code??null,before,after:process.umask(),neighborMode:statSync('neighbor').mode&511}));`;
        const result = boundedSpawnSync({
          label: "actual bounded scanner child outcome",
          command: process.execPath,
          args: [
            "--input-type=module",
            "-e",
            script,
            String(child),
            String(ioLatencyBudgetMs(2000)),
          ],
          cwd: lease,
          baseMs: 30000,
        });
        expect(result.status, String(result.stderr)).toBe(0);
        const actual = JSON.parse(String(result.stdout));
        expect(actual).toMatchObject({
          before: 0o022,
          after: 0o022,
          neighborMode: 0o644,
        });
        if (kind === "exit")
          expect(actual).toMatchObject({
            status: 42,
            signal: null,
            error: null,
          });
        else if (kind === "signal")
          expect(actual).toMatchObject({
            status: null,
            signal: "SIGTERM",
            error: null,
          });
        else
          expect(actual.error).toBe(
            kind === "timeout" ? "ETIMEDOUT" : "ENOBUFS"
          );
      } finally {
        rmSync(lease, { recursive: true, force: true });
      }
    }
  );
});

describe("safe report predicate observation before assertions", () => {
  it.each([
    ["private", '[{"Match":"REDACTED"}]', 0o600, true, 1, true],
    ["public", '[{"Match":"REDACTED"}]', 0o644, true, 1, true],
    ["malformed", "not json", 0o600, false, null, null],
    ["wrong-shape", "{}", 0o600, false, null, null],
    ["unredacted", '[{"Match":"synthetic-value"}]', 0o600, true, 1, false],
  ])(
    "records safe actual predicates for %s without raw report",
    (_name, bytes, mode, readable, count, absent) => {
      const lease = mkdtempSync(join(tmpdir(), "history-safe-report-"));
      try {
        const path = join(lease, "report.json");
        writeFileSync(path, String(bytes), { mode: Number(mode) });
        chmodSync(path, Number(mode));
        const result = observe(path, ["synthetic-value"]);
        expect(result).toMatchObject({
          regular: true,
          mode: Number(mode),
          readable,
          findingsCount: count,
          matchedValuesAbsent: absent,
        });
        expect(JSON.stringify(result)).not.toContain("synthetic-value");
        expect(JSON.stringify(result)).not.toContain(String(bytes));
        expect(JSON.stringify({ ...identity, ...result })).not.toContain(lease);
      } finally {
        rmSync(lease, { recursive: true, force: true });
      }
    }
  );
  it("refuses missing and nonregular observations", () => {
    const lease = mkdtempSync(join(tmpdir(), "history-missing-report-"));
    try {
      expect(observe(join(lease, "missing"), [])).toMatchObject({
        readable: false,
        findingsCount: null,
        matchedValuesAbsent: null,
      });
      expect(observe(lease, [])).toMatchObject({
        regular: false,
        readable: false,
        findingsCount: null,
        matchedValuesAbsent: null,
      });
      const link = join(lease, "link");
      symlinkSync(lease, link);
      expect(observe(link, [])).toMatchObject({
        regular: false,
        readable: false,
        findingsCount: null,
        matchedValuesAbsent: null,
      });
    } finally {
      rmSync(lease, { recursive: true, force: true });
    }
  });
});
