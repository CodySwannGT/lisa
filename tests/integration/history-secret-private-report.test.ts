/**
 * @file history-secret-private-report.test.ts
 * @description Genuine vendor private creation and failed-witness retention controls.
 * @module tests/history-secrets
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { selectPortableCases } from "../fixtures/git-history-secrets/portable-evidence.mjs";
import { requireCollectedEvidenceObservation } from "../fixtures/git-history-secrets/package.mjs";
useIoLatencyBudget();
const root = resolve(import.meta.dirname, "../..");
const lease = mkdtempSync(join(tmpdir(), "history-private-vendor-"));
const scanner = join(lease, "gitleaks");
const helper = "all/copy-overwrite/scripts/lib/history-secret-scanner.mjs";
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const environment = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ"]
    .filter(key => process.env[key] !== undefined)
    .map(key => [key, process.env[key]])
);
const childBaseMs = 30_000;
const portableOnly = "--portable-only";
const portablePartition = "--portable-partition";
const portableCredentialKeys = "--portable-credential-keys";
const expected = {
  positive: [
    "verified-digest-exact-bytes",
    "verified-binary-preimage",
    "verified-unicode-byte-attribution",
    "verified-reachable-history",
    "verified-narrative-paragraph",
    "verified-narrative-no-newline",
  ],
  digest: [
    "digest-wrong-role",
    "digest-nested-role",
    "digest-mismatch",
    "digest-absent-preimage",
    "digest-malformed-map",
    "digest-duplicate-key",
    "digest-escaped-duplicate-key",
    "digest-escaped-path-alias",
    "digest-escaped-value",
    "digest-unverified-sibling",
    "digest-unsafe-parent",
    "digest-unsafe-absolute",
    "digest-unavailable-revision",
    "digest-null-revision",
    "digest-false-revision",
    "digest-empty-revision",
    "digest-numeric-revision",
    "digest-ambiguous-line",
    "digest-invalid-utf8",
    "digest-depth-budget",
    "digest-token-budget",
    "digest-byte-budget",
    "digest-symlink-preimage",
    "digest-source-credential",
    "digest-adjacent-credential",
    "digest-other-default-rule",
    "digest-tag-object-revision",
    "digest-unreachable-revision",
  ],
  narrative: [
    "narrative-credential-assignment",
    "narrative-credential-json",
    "narrative-code-context",
    "narrative-interpolation",
    "narrative-arbitrary-substitution",
    "narrative-adjacent-credential",
  ],
};
/** Redacted native row from the original fixture report. */
type EvidenceObservation = {
  name: string;
};

beforeAll(() => {
  const result = boundedSpawnSync({
    label: "official pinned private-report scanner provision",
    command: process.execPath,
    args: [
      join(root, "all/copy-overwrite/scripts/lisa-history-secrets.mjs"),
      "provision",
      scanner,
    ],
    cwd: root,
    env: environment,
    baseMs: 30000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe(
    "Provisioned checksum/version-pinned Gitleaks 8.30.1.\n"
  );
});
afterAll(() => {
  rmSync(lease, { recursive: true, force: true });
  expect(existsSync(lease)).toBe(false);
});

const run = (mask: string, fault: string) => {
  const driver = `import {createHarness} from './tests/fixtures/git-history-secrets/harness.mjs';
import {emitArtifacts} from './tests/fixtures/git-history-secrets/package.mjs';
import {reportModeCase} from './tests/fixtures/git-history-secrets/report-mode.mjs';
import {chmodSync,existsSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
process.umask(parseInt(process.argv[2],8));const mask=process.umask();
const owner=mkdtempSync(join(tmpdir(),'history-private-observation-'));
const h=createHarness(['--scanner',process.argv[1],'--proof-dir',join(owner,'proof')]);
let succeeded=false,record=null,privateRecord=false,valuesAbsent=false;
try {
 emitArtifacts(h);const f=h.initialize('private-report');f.earlier=h.commit(f.cwd,'credential.txt',h.secret());
 const command=h.command;h.command=(...args)=>{
  const result=command(...args),report=join(h.scratch,'permission-report.json'),fault=process.argv[3];
  if(args[0]==='/bin/sh') {
   if(fault==='mode')chmodSync(report,420);
   if(fault==='malformed')writeFileSync(report,'not-json');
   if(fault==='missing')rmSync(report);
   if(fault==='nonregular'){rmSync(report);symlinkSync(h.scratch,report);}
   if(fault==='redaction')writeFileSync(report,JSON.stringify([{Match:h.values[0]}]));
  }return result;
 };
 try {await reportModeCase(h,f);succeeded=true;}catch {}
 const path=join(h.proof,'private-report-predicates.json');record=JSON.parse(readFileSync(path,'utf8'));
 privateRecord=(await import('node:fs')).statSync(path).mode&511;
 valuesAbsent=h.values.every(value=>!JSON.stringify(record).includes(value));
}finally{rmSync(h.scratch,{recursive:true,force:true});rmSync(owner,{recursive:true,force:true});}
console.log(JSON.stringify({succeeded,record,privateRecord,valuesAbsent,callerMask:process.umask(),initialMask:mask,scratchAbsent:!existsSync(h.scratch),proofOwnerAbsent:!existsSync(owner)}));
process.exitCode=succeeded?0:1;`;
  const result = boundedSpawnSync({
    label: "actual pinned vendor permission and retained failure witness",
    command: process.execPath,
    args: ["--input-type=module", "-e", driver, scanner, mask, fault],
    cwd: root,
    env: environment,
    baseMs: 30000,
  });
  expect(result.status, result.stderr).toBe(fault === "none" ? 0 : 1);
  return JSON.parse(String(result.stdout));
};
describe("genuine scanner report private creation and observation", () => {
  it.each(["022", "077"])(
    "preserves actual vendor mode/redaction with caller %s",
    mask => {
      const actual = run(mask, "none");
      expect(actual).toMatchObject({
        succeeded: true,
        privateRecord: 0o600,
        valuesAbsent: true,
        callerMask: Number.parseInt(mask, 8),
        initialMask: Number.parseInt(mask, 8),
        scratchAbsent: true,
        proofOwnerAbsent: true,
      });
      expect(actual.record).toMatchObject({
        nativeReturned: true,
        exit: 42,
        signal: null,
        regular: true,
        mode: 0o600,
        readable: true,
        findingsCount: 1,
        matchedValuesAbsent: true,
        identity: {
          scannerVersion: "8.30.1",
          scannerSha256: hash(scanner),
          sourceSha256: hash(join(root, helper)),
          archiveSha256: null,
        },
      });
    }
  );
  it.each(["mode", "malformed", "missing", "nonregular", "redaction"])(
    "retains safe failed %s predicates before owned cleanup",
    fault => {
      const actual = run("022", fault);
      expect(actual).toMatchObject({
        succeeded: false,
        privateRecord: 0o600,
        valuesAbsent: true,
        callerMask: 0o022,
        scratchAbsent: true,
        proofOwnerAbsent: true,
      });
      expect(actual.record).toMatchObject({
        nativeReturned: true,
        exit: 42,
        signal: null,
        identity: {
          scannerVersion: "8.30.1",
          scannerSha256: hash(scanner),
          sourceSha256: hash(join(root, helper)),
        },
      });
      if (fault === "mode") expect(actual.record.mode).toBe(0o644);
      else if (fault === "redaction")
        expect(actual.record.matchedValuesAbsent).toBe(false);
      else expect(actual.record.readable).toBe(false);
    }
  );
});

describe("legacy evidence exact attribution and refusal", () => {
  it.each([
    [portableOnly, portablePartition],
    [portableOnly, portablePartition, "third"],
    [portableOnly, "--portable-partition=first"],
    [portableOnly, "--portable-partition-extra", "first"],
    [portableOnly, portablePartition, "first", portablePartition, "second"],
    [portablePartition, "first"],
    [portableOnly, portableCredentialKeys, portablePartition, "first"],
  ])("refuses malformed or incompatible portable selectors %#", (...flags) => {
    expect(() => selectPortableCases(flags)).toThrow(
      "Unknown portable control selector."
    );
  });
  it.each([
    ["positive", "positive", null, expected.positive],
    ["digest-first", "digest", "first", expected.digest.slice(0, 14)],
    ["digest-second", "digest", "second", expected.digest.slice(14)],
    ["narrative", "narrative", null, expected.narrative],
    [
      "coexistence",
      "coexistence",
      null,
      [
        "immutable-coexist-strict-source",
        "immutable-coexist-catalogue-proof",
        "immutable-coexist-incomplete-map",
      ],
    ],
    [
      "bytes-within",
      "immutable-bytes-within",
      null,
      ["immutable-bytes-within"],
    ],
    [
      "bytes-exhausted",
      "immutable-bytes-exhausted",
      null,
      ["immutable-bytes-exhausted"],
    ],
    [
      "blobs-within",
      "immutable-blobs-within",
      null,
      ["immutable-blobs-within", "immutable-blobs-within-detector"],
    ],
    [
      "blobs-exhausted",
      "immutable-blobs-exhausted",
      null,
      ["immutable-blobs-exhausted", "immutable-blobs-exhausted-detector"],
    ],
  ] as const)(
    "executes the exact nonempty %s controls with redaction and cleanup",
    (label, group, partition, names) => {
      expect(names.length).toBeGreaterThan(0);
      const result = boundedSpawnSync({
        label: `actual emitted evidence CLI ${label} controls`,
        command: process.execPath,
        args: [
          join(root, "tests/fixtures/git-history-secrets/journey.mjs"),
          group === "coexistence" || group.startsWith("immutable-")
            ? "--immutable-only"
            : "--evidence-only",
          group === "coexistence" || group.startsWith("immutable-")
            ? "--immutable-group"
            : "--evidence-group",
          group,
          ...(partition === null ? [] : ["--evidence-partition", partition]),
          "--scanner",
          scanner,
        ],
        cwd: root,
        baseMs: childBaseMs,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      const report = JSON.parse(result.stdout) as {
        scanner: string;
        redaction: boolean;
        cleanup: string;
        observations: EvidenceObservation[];
      };
      expect(report.scanner).toBe("Gitleaks 8.30.1");
      expect(report.redaction).toBe(true);
      expect(report.cleanup).toBe(
        "all owned fixture repositories/processes removed on exit"
      );
      expect(report.observations.map(observation => observation.name)).toEqual(
        names
      );
      for (const observation of report.observations) {
        requireCollectedEvidenceObservation(expect, observation, group);
      }
    }
  );
});
