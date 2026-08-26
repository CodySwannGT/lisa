/** Fail-closed validation for untrusted learning entries and provenance arrays. */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEARNINGS_CONTRACT } from "../../../src/core/learnings-contract.js";
import { persistLearningEntry } from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LEDGER = path.join(".lisa", "PROJECT_LEARNINGS.md");
const POLLUTED_ENTRY_FIELDS = ["id", "fingerprint"] as const;
const CANDIDATE_ID = "entry-security-candidate";
const CANDIDATE_PROVENANCE = "issue:#candidate";

/**
 * Build one compact valid learning entry.
 * @param id - Stable identity and fingerprint suffix
 * @returns Exact current-schema entry
 */
function entry(id: string) {
  return {
    id,
    fingerprint: `${id}-fingerprint`,
    rule: `Rule ${id}.`,
    why: `Why ${id}.`,
    provenance: [`issue:#${id}`],
    first_learned: "2026-08-26",
    last_confirmed: "2026-08-26",
    confidence: "high",
  } as const;
}

const VICTIM = entry("entry-security-victim");

describe("learning entry security", () => {
  let projectRoot: string;
  let ledger: string;

  beforeEach(async () => {
    projectRoot = await createTempDir();
    ledger = path.join(projectRoot, LEDGER);
    await persistLearningEntry(projectRoot, VICTIM);
  });

  afterEach(async () => {
    for (const field of POLLUTED_ENTRY_FIELDS) {
      delete (Object.prototype as Record<string, unknown>)[field];
    }
    delete (Object.prototype as Record<string, unknown>)["0"];
    await cleanupTempDir(projectRoot);
  });

  /**
   * Prove invalid caller input fails before changing persisted bytes.
   * @param candidate - Hostile caller-controlled entry
   * @param diagnosis - Expected validation diagnosis
   */
  async function expectAtomicRejection(
    candidate: unknown,
    diagnosis: RegExp
  ): Promise<void> {
    const before = await readFile(ledger, "utf8");
    await expect(persistLearningEntry(projectRoot, candidate)).rejects.toThrow(
      diagnosis
    );
    expect(await readFile(ledger, "utf8")).toBe(before);
  }

  it("does not resolve missing entry fields through a polluted Object prototype", async () => {
    const candidate = { ...entry(CANDIDATE_ID) } as Record<string, unknown>;
    delete candidate.id;
    delete candidate.fingerprint;
    candidate.unrelatedId = "ignored";
    candidate.unrelatedFingerprint = "ignored";
    Object.defineProperties(Object.prototype, {
      id: {
        configurable: true,
        value: { value: "entry-security-forged" },
      },
      fingerprint: {
        configurable: true,
        value: { value: "entry-security-forged-fingerprint" },
      },
    });

    const before = await readFile(ledger, "utf8");
    let write: Promise<string>;
    try {
      // Entry validation runs synchronously until the writer's first await.
      // Remove pollution immediately so the test runtime never consumes it.
      write = persistLearningEntry(projectRoot, candidate);
    } finally {
      for (const field of POLLUTED_ENTRY_FIELDS) {
        delete (Object.prototype as Record<string, unknown>)[field];
      }
    }

    await expect(write).rejects.toThrow(/entry fields.*exactly/i);
    expect(await readFile(ledger, "utf8")).toBe(before);
  });

  it("does not resolve a provenance hole through an inherited descriptor", async () => {
    const provenance: unknown[] = [];
    provenance.length = 1;
    Object.defineProperty(Object.prototype, "0", {
      configurable: true,
      writable: true,
      value: { value: "issue:#entry-security-forged" },
    });
    const candidate = {
      ...entry(CANDIDATE_ID),
      provenance,
    };

    const before = await readFile(ledger, "utf8");
    let write: Promise<string>;
    try {
      write = persistLearningEntry(projectRoot, candidate);
    } finally {
      delete (Object.prototype as Record<string, unknown>)["0"];
    }

    await expect(write).rejects.toThrow(/provenance.*array|dense|own/i);
    expect(await readFile(ledger, "utf8")).toBe(before);
  });

  it.each([
    [
      "sparse",
      () => {
        const provenance: unknown[] = [];
        provenance.length = 1;
        return provenance;
      },
    ],
    [
      "expando",
      () => Object.assign([CANDIDATE_PROVENANCE], { unexpected: true }),
    ],
    [
      "symbol",
      () => {
        const provenance = [CANDIDATE_PROVENANCE];
        Object.defineProperty(provenance, Symbol("hostile"), { value: true });
        return provenance;
      },
    ],
  ] as const)("rejects a %s provenance array", async (_name, build) => {
    await expectAtomicRejection(
      { ...entry(CANDIDATE_ID), provenance: build() },
      /provenance.*array|accessor/i
    );
  });

  it("rejects an indexed provenance getter without invoking it", async () => {
    let getterCalls = 0;
    const provenance: unknown[] = [];
    provenance.length = 1;
    Object.defineProperty(provenance, "0", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return CANDIDATE_PROVENANCE;
      },
    });

    await expectAtomicRejection(
      { ...entry(CANDIDATE_ID), provenance },
      /provenance.*array|accessor/i
    );
    expect(getterCalls).toBe(0);
  });

  it("rejects an entry getter without invoking it", async () => {
    let getterCalls = 0;
    const candidate = { ...entry(CANDIDATE_ID) } as Record<string, unknown>;
    Object.defineProperty(candidate, "why", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "hostile";
      },
    });

    await expectAtomicRejection(candidate, /why.*accessor/i);
    expect(getterCalls).toBe(0);
  });

  it("covers the current eight-field contract exactly", () => {
    expect(LEARNINGS_CONTRACT.fields).toHaveLength(8);
  });
});
