/** Required actual default-scanner regressions for verified history evidence. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

useIoLatencyBudget();
const root = resolve(import.meta.dirname, "../..");
const lease = mkdtempSync(join(tmpdir(), "history-evidence-scanner-"));
const scanner = join(lease, "gitleaks");
// The aggregate digest workload is partitioned into two 14-control children.
// Each child and case retains the existing bounded budget and margin guard.
const childBaseMs = 30_000;
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

beforeAll(() => {
  const provision = boundedSpawnSync({
    label: "official checksum/version-qualified default scanner provisioning",
    command: process.execPath,
    args: [
      join(root, "all/copy-overwrite/scripts/lisa-history-secrets.mjs"),
      "provision",
      scanner,
    ],
    cwd: root,
    baseMs: childBaseMs,
  });
  expect(provision.status, provision.stderr).toBe(0);
  expect(provision.stdout).toBe(
    "Provisioned checksum/version-pinned Gitleaks 8.30.1.\n"
  );
});

afterAll(() => {
  rmSync(lease, { recursive: true, force: true });
  expect(existsSync(lease)).toBe(false);
});

describe("required history evidence actual CLI controls", () => {
  it.each([
    ["portable", [], 20, 8],
    ["reserved-keys", ["--portable-credential-keys"], 6, 0],
  ] as const)(
    "executes exact %s committed evidence controls",
    (_name, flags, count, positiveCount) => {
      const result = boundedSpawnSync({
        label: "actual portable committed evidence CLI controls",
        command: process.execPath,
        args: [
          join(root, "tests/fixtures/git-history-secrets/journey.mjs"),
          "--portable-only",
          ...flags,
          "--scanner",
          scanner,
        ],
        cwd: root,
        baseMs: childBaseMs,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      const report = JSON.parse(result.stdout);
      expect(report.scanner).toBe("Gitleaks 8.30.1");
      expect(report.redaction).toBe(true);
      expect(report.cleanup).toBe(
        "all owned fixture repositories/processes removed on exit"
      );
      expect(report.observations).toHaveLength(count);
      expect(
        report.observations.filter((row: { exit: number }) => row.exit === 0)
      ).toHaveLength(positiveCount);
      for (const row of report.observations)
        expect(row.exit).toBe(row.expected);
    }
  );
  it.each([
    ["positive", "positive", null, expected.positive],
    ["digest-first", "digest", "first", expected.digest.slice(0, 14)],
    ["digest-second", "digest", "second", expected.digest.slice(14)],
    ["narrative", "narrative", null, expected.narrative],
  ] as const)(
    "executes the exact nonempty %s controls with redaction and cleanup",
    (label, group, partition, names) => {
      expect(names.length).toBeGreaterThan(0);
      const result = boundedSpawnSync({
        label: `actual emitted evidence CLI ${label} controls`,
        command: process.execPath,
        args: [
          join(root, "tests/fixtures/git-history-secrets/journey.mjs"),
          "--evidence-only",
          "--evidence-group",
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
        observations: {
          name: string;
          exit: number;
          commits: number;
          preimageVerified: boolean;
        }[];
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
        expect(observation.exit).toBe(group === "positive" ? 0 : 42);
        expect(observation.commits).toBe(
          ["verified-reachable-history", "digest-tag-object-revision"].includes(
            observation.name
          )
            ? 3
            : 2
        );
        expect(observation.preimageVerified).toBe(
          group === "positive" &&
            !observation.name.startsWith("verified-narrative")
        );
      }
    }
  );
});
