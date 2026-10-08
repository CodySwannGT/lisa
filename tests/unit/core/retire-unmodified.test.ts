/**
 * Unit tests for the unmodified-only retirement rule (CodySwannGT/lisa#4393).
 * @module tests/unit/core/retire-unmodified
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DeletionsConfig } from "../../../src/core/config.js";
import { resolveDeletionBasis } from "../../../src/core/deletion-basis.js";
import { LISA_OWNED_HASH_LEDGER } from "../../../src/core/lisa-owned-hash-ledger.js";
import {
  findHostReferences,
  isShippedVersion,
  readRegularFile,
  retiredDigests,
  stillProved,
} from "../../../src/core/retire-unmodified.js";

const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
const PATH = "scripts/retired.mjs";
const byText = (left: string, right: string): number =>
  left.localeCompare(right);
const BODY = "export const x = 1;\n";

const config = (
  retire: Record<string, readonly string[]>
): DeletionsConfig => ({
  paths: Object.keys(retire),
  retireUnmodified: retire,
});

describe("retiredDigests", () => {
  it("is null for a path the manifest does not retire this way", () => {
    expect(retiredDigests(config({}), PATH, {})).toBeNull();
  });

  it("unions the manifest's digests with the ledger's", () => {
    const digests = retiredDigests(config({ [PATH]: [sha256(BODY)] }), PATH, {
      [PATH]: ["b".repeat(64)],
    });
    expect([...(digests ?? [])].sort(byText)).toEqual(
      [sha256(BODY), "b".repeat(64)].sort(byText)
    );
  });

  it("drops malformed digests but keeps the path opted in", () => {
    const digests = retiredDigests(
      config({ [PATH]: ["ABC", "nope", 7 as unknown as string] }),
      PATH,
      {}
    );
    expect(digests).not.toBeNull();
    expect(digests?.size).toBe(0);
  });
});

describe("isShippedVersion", () => {
  const shipped = new Set([sha256(BODY)]);

  it("matches the exact bytes", () => {
    expect(isShippedVersion(Buffer.from(BODY), shipped)).toBe(true);
  });

  it("matches the same text with CRLF line endings", () => {
    expect(
      isShippedVersion(Buffer.from(BODY.replaceAll("\n", "\r\n")), shipped)
    ).toBe(true);
  });

  it("does not match an edited copy", () => {
    expect(isShippedVersion(Buffer.from(`${BODY}// mine\n`), shipped)).toBe(
      false
    );
  });
});

describe("findHostReferences", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "retire-refs-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds package.json scripts and workflows that name the path, but not the path itself", async () => {
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { go: `node ${PATH}` } })
    );
    mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(
      path.join(dir, ".github", "workflows", "a.yml"),
      `run: node ${PATH}\n`
    );
    writeFileSync(path.join(dir, ".github", "workflows", "b.yaml"), "run: x\n");
    expect(await findHostReferences(dir, PATH)).toEqual([
      ".github/workflows/a.yml",
      "package.json",
    ]);
    expect(await findHostReferences(dir, ".github/workflows/a.yml")).toEqual(
      []
    );
  });

  // Root reads a mode-000 file anyway, so the case is meaningless there.
  it.skipIf(process.getuid?.() === 0)(
    "reports unknown, not none, when a workflow cannot be read",
    async () => {
      mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
      const locked = path.join(dir, ".github", "workflows", "locked.yml");
      writeFileSync(locked, `run: node ${PATH}\n`);
      chmodSync(locked, 0o000);
      try {
        expect(await findHostReferences(dir, PATH)).toBeNull();
      } finally {
        chmodSync(locked, 0o600);
      }
    }
  );

  it("reports nothing for a project without either file", async () => {
    expect(await findHostReferences(dir, PATH)).toEqual([]);
  });
});

describe("stillProved", () => {
  it("holds for an untouched file and fails once it is replaced or edited", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "retire-proof-"));
    try {
      const file = path.join(dir, "retired.mjs");
      writeFileSync(file, BODY);
      const proof = await readRegularFile(file);
      expect(proof).not.toBeNull();
      if (proof === null) return;
      expect(await stillProved(file, proof)).toBe(true);
      writeFileSync(file, `${BODY}// edited\n`);
      expect(await stillProved(file, proof)).toBe(false);
      rmSync(file);
      writeFileSync(file, BODY);
      // Same bytes, different inode: not the file that was proved.
      expect(await stillProved(file, proof)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the shipped all/deletions.json", () => {
  const manifest = JSON.parse(
    readFileSync(path.resolve("all/deletions.json"), "utf8")
  ) as DeletionsConfig;

  it("declares, and gives a basis to, every path it retires while unmodified", () => {
    const retire = manifest.retireUnmodified ?? {};
    expect(Object.keys(retire).length).toBeGreaterThan(0);
    for (const [declared, digests] of Object.entries(retire)) {
      expect(manifest.paths).toContain(declared);
      expect(manifest.keep ?? []).not.toContain(declared);
      expect(resolveDeletionBasis(manifest, declared).kind).toBe("legacy");
      expect(digests.length).toBeGreaterThan(0);
      for (const digest of digests) expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it("retires the PAT workflow and the self-update script it ran", () => {
    const retire = manifest.retireUnmodified ?? {};
    expect(Object.keys(retire)).toEqual(
      expect.arrayContaining([
        ".github/workflows/lisa-update.yml",
        "scripts/lisa-self-update.mjs",
      ])
    );
    // Every self-update version the ledger knows Lisa shipped is retirable.
    expect(
      [...(retire["scripts/lisa-self-update.mjs"] ?? [])].sort(byText)
    ).toEqual(
      expect.arrayContaining([
        ...(LISA_OWNED_HASH_LEDGER["scripts/lisa-self-update.mjs"] ?? []),
      ])
    );
  });
});
