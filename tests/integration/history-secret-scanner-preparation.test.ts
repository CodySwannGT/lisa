/**
 * @file history-secret-scanner-preparation.test.ts
 * @description The invocation's one cold pinned-scanner acquisition, its owned
 * handoff, and the refusals that keep reuse from bypassing either. The
 * network-free failure controls of the acquisition itself are in
 * tests/unit/helpers/history-scanner-preparation.test.ts.
 * @module tests/history-secrets
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, inject, it } from "vitest";

import { qualifyScanner } from "../../all/copy-overwrite/scripts/lib/history-secret-scanner.mjs";
import { ownedPreparedScanner } from "../helpers/history-scanner-handoff.js";
import {
  COLD_PROVISION_DEADLINE_MS,
  PREPARATION_RECORD,
  PROVISIONED,
  PROVISION_CLI,
  platformPin,
  type ReadyPreparation,
} from "../helpers/history-scanner-preparation.js";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";

useIoLatencyBudget();
const root = resolve(import.meta.dirname, "../..");
const lease = mkdtempSync(join(tmpdir(), "history-scanner-preparation-"));
const provided = inject("historyScannerPreparation");
const pin = platformPin();
const digest = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * The provided preparation, which every case here needs to be the real one.
 * @returns The ready preparation
 */
function ready(): ReadyPreparation {
  if (provided?.ok !== true)
    throw new Error(`No ready cold preparation: ${JSON.stringify(provided)}`);
  return provided;
}

/** Paths inside one crafted copy of the genuine prepared scope. */
interface Crafted {
  readonly owner: string;
  readonly scope: string;
  readonly executable: string;
  readonly record: string;
  readonly marker: string;
  readonly source: ReadyPreparation;
}

/** The single thing wrong with each crafted copy. */
const FAULTS = {
  none: () => undefined,
  "missing-executable": ({ executable }: Crafted) => rmSync(executable),
  "corrupt-executable": ({ executable }: Crafted) => {
    const bytes = readFileSync(executable);
    bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 0xff;
    writeFileSync(executable, bytes);
  },
  "unqualified-executable": ({ executable, marker }: Crafted) =>
    writeFileSync(
      executable,
      `#!/bin/sh\nprintf invoked > ${quote(marker)}\nprintf '8.30.1\\n'\n`
    ),
  "symlink-executable": ({ executable, source }: Crafted) => {
    rmSync(executable);
    symlinkSync(source.executable, executable);
  },
  "missing-record": ({ record }: Crafted) => rmSync(record),
  "corrupt-record": ({ record }: Crafted) => writeFileSync(record, "not-json"),
  "symlink-record": ({ record, source }: Crafted) => {
    rmSync(record);
    symlinkSync(join(source.scope, PREPARATION_RECORD), record);
  },
  "unknown-provenance": ({ record }: Crafted) =>
    writeFileSync(
      record,
      JSON.stringify({
        ...JSON.parse(readFileSync(record, "utf8")),
        nonce: "0".repeat(32),
      })
    ),
  "shared-scope": ({ scope }: Crafted) => chmodSync(scope, 0o755),
  "symlink-scope": ({ owner, scope }: Crafted) =>
    symlinkSync(scope, join(owner, "linked-scope")),
} as const;

/**
 * Copy the genuine prepared scope into an owned one, then apply one fault.
 * @param fault - The single thing wrong with the copy
 * @returns A preparation naming the copy, where its handoff may write, and
 * the file an unqualified executable would create if it were ever run
 */
function crafted(fault: keyof typeof FAULTS): {
  readonly preparation: ReadyPreparation;
  readonly destination: string;
  readonly marker: string;
} {
  const source = ready();
  const owner = mkdtempSync(join(lease, `${fault}-`));
  const scope = join(owner, "scope");
  const named = fault === "symlink-scope" ? join(owner, "linked-scope") : scope;
  const paths: Crafted = {
    owner,
    scope,
    executable: join(scope, "gitleaks"),
    record: join(scope, PREPARATION_RECORD),
    marker: join(owner, "unqualified-was-executed"),
    source,
  };
  mkdirSync(scope, { mode: 0o700 });
  writeFileSync(
    paths.record,
    readFileSync(join(source.scope, PREPARATION_RECORD)),
    { mode: 0o600 }
  );
  writeFileSync(paths.executable, readFileSync(source.executable), {
    mode: 0o700,
  });
  FAULTS[fault](paths);
  return {
    preparation: {
      ...source,
      scope: named,
      executable: join(named, "gitleaks"),
    },
    destination: join(owner, "owned-gitleaks"),
    marker: paths.marker,
  };
}

afterAll(() => {
  rmSync(lease, { recursive: true, force: true });
  expect(existsSync(lease)).toBe(false);
});

describe("the invocation's one genuine cold scanner acquisition", () => {
  it("ran the unchanged production CLI provision against the official release", () => {
    const { evidence, scope } = ready();
    expect(evidence.argv).toEqual([
      process.execPath,
      join(root, PROVISION_CLI),
      "provision",
      join(scope, "gitleaks"),
    ]);
    expect(evidence).toMatchObject({
      status: 0,
      signal: null,
      errorCode: null,
      stdout: PROVISIONED,
      deadlineMs: COLD_PROVISION_DEADLINE_MS,
      platform: `${process.platform}_${process.arch}`,
      executableSha256: pin?.binary,
      version: "8.30.1",
    });
    expect(evidence.elapsedMs).toBeLessThan(evidence.deadlineMs);
  });
});

describe("the qualified owned handoff to each bounded control", () => {
  it("hands a control a qualified owned copy of exactly that scanner", () => {
    const destination = join(mkdtempSync(join(lease, "positive-")), "gitleaks");
    const owned = ownedPreparedScanner(destination, provided);
    const entry = lstatSync(destination);
    expect(owned).toEqual({
      path: destination,
      sha256: pin?.binary,
      version: "8.30.1",
      provision: {
        argv: ready().evidence.argv,
        status: 0,
        stdout: PROVISIONED,
      },
    });
    expect(entry.isFile() && !entry.isSymbolicLink()).toBe(true);
    expect(entry.mode & 0o777).toBe(0o700);
    expect(digest(destination)).toBe(pin?.binary);
    expect(qualifyScanner(destination)).toBe(destination);
  });

  it("accepts a faithful copy of the prepared scope, so each refusal is its fault alone", () => {
    const { preparation, destination } = crafted("none");
    const owned = ownedPreparedScanner(destination, preparation);
    expect(owned.sha256).toBe(pin?.binary);
  });

  it.each([
    ["missing-executable", /the prepared executable is missing/u],
    ["corrupt-executable", /not the pinned official executable/u],
    ["unqualified-executable", /not the pinned official executable/u],
    ["symlink-executable", /the prepared executable is a symbolic link/u],
    ["missing-record", /the preparation record is missing/u],
    ["corrupt-record", /the preparation record is malformed/u],
    ["symlink-record", /the preparation record is a symbolic link/u],
    [
      "unknown-provenance",
      /not written by this invocation's cold acquisition/u,
    ],
    ["shared-scope", /the preparation scope is not private to this user/u],
    ["symlink-scope", /the preparation scope is a symbolic link/u],
  ] as const)(
    "refuses a %s preparation without executing or supplying anything",
    (fault, refusal) => {
      const { preparation, destination, marker } = crafted(fault);
      expect(() => ownedPreparedScanner(destination, preparation)).toThrow(
        refusal
      );
      expect(existsSync(destination)).toBe(false);
      expect(existsSync(marker)).toBe(false);
    }
  );

  it.each([
    ["absent", undefined, /no cold scanner preparation ran/u],
    [
      "failed",
      {
        ok: false,
        reason: "The cold scanner provision exited 1.",
        evidence: null,
      },
      /preparation failed\. The cold scanner provision exited 1/u,
    ],
  ] as const)("refuses an %s preparation", (_name, preparation, refusal) => {
    const destination = join(mkdtempSync(join(lease, "refused-")), "gitleaks");
    expect(() => ownedPreparedScanner(destination, preparation)).toThrow(
      refusal
    );
    expect(existsSync(destination)).toBe(false);
  });
});
