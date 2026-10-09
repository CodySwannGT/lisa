/** Required actual default-scanner regressions for verified history evidence. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { selectPortableCases } from "../fixtures/git-history-secrets/portable-evidence.mjs";

useIoLatencyBudget();
const root = resolve(import.meta.dirname, "../..");
const lease = mkdtempSync(join(tmpdir(), "history-evidence-scanner-"));
const scanner = join(lease, "gitleaks");
// Serial native workloads are partitioned into disjoint bounded children.
// Each child and case retains the existing bounded budget and margin guard.
const childBaseMs = 30_000;
const CLEANUP = "all owned fixture repositories/processes removed on exit";
const portableOnly = "--portable-only";
const portablePartition = "--portable-partition";
const portableCredentialKeys = "--portable-credential-keys";
const portableNames = [
  "portable-source-hashes",
  "portable-source-hashes-after",
  "portable-bare-source-map",
  "portable-fenced-source-map",
  "portable-proof-catalogue",
  "portable-selected-artifact",
  "portable-narrative-sentence",
  "portable-source-introduced-history",
  "portable-catalogue-mismatch",
  "portable-catalogue-absent",
  "portable-catalogue-symlink",
  "portable-catalogue-foreign-head",
  "portable-source-path-mismatch",
  "portable-proof-credential-role",
  "portable-duplicate-role",
  "portable-escaped-proof-value",
  "portable-narrative-code-fence",
  "portable-adjacent-credential",
  "portable-proof-unverified-sibling",
  "portable-proof-credential-sibling",
];
const reservedNames = ["api_key", "access_token", "password"].flatMap(key => [
  `portable-proof-key-${key}`,
  `portable-source-key-${key}`,
]);

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
    [
      "first",
      [
        "immutable-selected-ancestor",
        "immutable-mixed-revisions",
        "immutable-binary-preimage",
        "immutable-unicode-offset",
      ],
      4,
    ],
    [
      "second",
      [
        "immutable-complete-fence",
        "immutable-later-archive",
        "immutable-typed-parent",
        "immutable-missing-sibling",
      ],
      3,
    ],
    [
      "third",
      [
        "immutable-wrong-blob",
        "immutable-wrong-span",
        "immutable-duplicate-coordinate",
        "immutable-unknown-field",
      ],
      0,
    ],
    [
      "fourth",
      [
        "immutable-null-parent",
        "immutable-wrong-role",
        "immutable-conflicting-versions",
        "immutable-archive-mismatch",
      ],
      0,
    ],
    [
      "fifth",
      [
        "immutable-archive-outside-selection",
        "immutable-archive-credential",
        "immutable-sidecar-credential",
        "immutable-evidence-credential",
      ],
      0,
    ],
    [
      "sixth",
      [
        "immutable-escaped-coordinate",
        "immutable-duplicate-sidecar-key",
        "immutable-overlapping-span",
        "immutable-unsafe-integer",
      ],
      0,
    ],
    [
      "seventh",
      [
        "immutable-absolute-source",
        "immutable-parent-source",
        "immutable-credential-role",
        "immutable-multiple-fences",
      ],
      0,
    ],
    [
      "eighth",
      [
        "immutable-sidecar-symlink",
        "immutable-source-symlink",
        "immutable-archive-symlink",
        "immutable-ancestor-blob-object",
      ],
      0,
    ],
    [
      "ninth",
      [
        "immutable-ancestor-tag-object",
        "immutable-ancestor-off-chain",
        "immutable-conflicting-parent",
        "immutable-unflagged-sibling",
      ],
      0,
    ],
    [
      "tenth",
      [
        "immutable-manifest-token-budget",
        "immutable-manifest-depth-budget",
        "immutable-manifest-byte-budget",
        "immutable-map-entry-budget",
      ],
      0,
    ],
    [
      "eleventh",
      [
        "immutable-source-tree",
        "immutable-source-submodule",
        "immutable-archive-worktree-only",
        "immutable-origin-not-selected",
      ],
      0,
    ],
    [
      "narrative",
      [
        "immutable-larger-paragraph",
        "immutable-quoted-paragraph",
        "immutable-inline-paragraph",
        "immutable-linked-paragraph",
      ],
      1,
    ],
    [
      "narrative-boundaries",
      [
        "immutable-lazy-blockquote",
        "immutable-credential-field-prose",
        "immutable-unrelated-quotation",
        "immutable-fenced-paragraph",
      ],
      1,
    ],
  ] as const)(
    "executes the exact immutable %s original-input controls",
    (group, names, positiveCount) => {
      const result = boundedSpawnSync({
        label: `actual immutable coordinate ${group} controls`,
        command: process.execPath,
        args: [
          join(root, "tests/fixtures/git-history-secrets/journey.mjs"),
          "--immutable-only",
          "--immutable-group",
          group,
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
      expect(report.cleanup).toBe(CLEANUP);
      expect(
        report.observations.map((row: { name: string }) => row.name)
      ).toEqual(names);
      expect(
        report.observations.filter((row: { exit: number }) => row.exit === 0)
      ).toHaveLength(positiveCount);
      for (const row of report.observations) {
        expect(row.exit).toBe(row.expected);
        expect(row.selectedCommits).toBeGreaterThan(0);
      }
    }
  );
  it("preserves the exact default and disjoint union of all portable controls", () => {
    const names = (flags: string[]) =>
      selectPortableCases(flags).map(row => row[0]);
    const first = names([portableOnly, portablePartition, "first"]);
    const second = names([portableOnly, portablePartition, "second"]);
    expect(names([])).toEqual(portableNames);
    expect(first).toEqual(portableNames.slice(0, 10));
    expect(second).toEqual(portableNames.slice(10));
    expect([...first, ...second]).toEqual(portableNames);
    expect(new Set([...first, ...second]).size).toBe(20);
    expect(selectPortableCases([]).map(row => row[2])).toEqual([
      ...Array<number>(8).fill(0),
      ...Array<number>(12).fill(42),
    ]);
    expect(names([portableOnly, portableCredentialKeys])).toEqual(
      reservedNames
    );
  });
  it.each([
    [
      "portable-first",
      [portablePartition, "first"],
      portableNames.slice(0, 10),
      8,
    ],
    [
      "portable-second",
      [portablePartition, "second"],
      portableNames.slice(10),
      0,
    ],
    ["reserved-keys", [portableCredentialKeys], reservedNames, 0],
  ] as const)(
    "executes exact %s committed evidence controls",
    (_name, flags, names, positiveCount) => {
      const result = boundedSpawnSync({
        label: "actual portable committed evidence CLI controls",
        command: process.execPath,
        args: [
          join(root, "tests/fixtures/git-history-secrets/journey.mjs"),
          portableOnly,
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
      expect(report.cleanup).toBe(CLEANUP);
      expect(
        report.observations.map((row: { name: string }) => row.name)
      ).toEqual(names);
      expect(
        report.observations.filter((row: { exit: number }) => row.exit === 0)
      ).toHaveLength(positiveCount);
      for (const [index, row] of report.observations.entries()) {
        expect(row.exit).toBe(row.expected);
        expect(row.exit).toBe(index < positiveCount ? 0 : 42);
      }
    }
  );
});
