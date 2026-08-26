/** Fail-closed validation for untrusted supersede stamps and containers. */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LEARNINGS_CONTRACT,
  MAX_STABLE_TOKEN_BYTES,
} from "../../../src/core/learnings-contract.js";
import { persistConsolidatedLearning } from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LEDGER = path.join(".lisa", "PROJECT_LEARNINGS.md");
const VICTIM_ID = "security-victim";

/**
 * Build one compact valid learning entry.
 * @param id - Stable identity and initial fingerprint
 * @returns Exact current-schema entry
 */
function entry(id: string) {
  return {
    id,
    fingerprint: id,
    rule: `Rule ${id}.`,
    why: `Why ${id}.`,
    provenance: [`issue:#${id}`],
    first_learned: "2026-08-26",
    last_confirmed: "2026-08-26",
    confidence: "high",
  } as const;
}

const VICTIM_STAMP = { id: VICTIM_ID, fingerprint: VICTIM_ID } as const;

describe("supersede stamp security", () => {
  let projectRoot: string;
  let ledger: string;

  beforeEach(async () => {
    projectRoot = await createTempDir();
    ledger = path.join(projectRoot, LEDGER);
    await persistConsolidatedLearning(projectRoot, entry(VICTIM_ID));
  });

  afterEach(async () => {
    delete (Object.prototype as { id?: unknown }).id;
    delete (Object.prototype as { fingerprint?: unknown }).fingerprint;
    await cleanupTempDir(projectRoot);
  });

  /**
   * Prove an invalid supersede option fails before changing persisted bytes.
   * @param supersede - Hostile caller-controlled option
   * @param diagnosis - Expected validation diagnosis
   */
  async function expectAtomicRejection(
    supersede: unknown,
    diagnosis: RegExp
  ): Promise<void> {
    const before = await readFile(ledger, "utf8");
    await expect(
      persistConsolidatedLearning(projectRoot, entry("security-candidate"), {
        supersede: supersede as never,
      })
    ).rejects.toThrow(diagnosis);
    expect(await readFile(ledger, "utf8")).toBe(before);
  }

  it("does not resolve missing stamp fields through a polluted Object prototype", async () => {
    const falseStamp = { harmless: true, stillHarmless: true };
    Object.defineProperties(Object.prototype, {
      id: {
        configurable: true,
        value: { value: VICTIM_STAMP.id },
      },
      fingerprint: {
        configurable: true,
        value: { value: VICTIM_STAMP.fingerprint },
      },
    });
    const before = await readFile(ledger, "utf8");
    let write: Promise<string>;
    try {
      // Validation runs synchronously until the first filesystem await. Remove
      // the pollution immediately after the call so test infrastructure never
      // observes it, while the vulnerable parser has already consumed it.
      write = persistConsolidatedLearning(
        projectRoot,
        entry("security-candidate"),
        { supersede: [falseStamp] as never }
      );
    } finally {
      delete (Object.prototype as { id?: unknown }).id;
      delete (Object.prototype as { fingerprint?: unknown }).fingerprint;
    }
    await expect(write).rejects.toThrow(/exactly.*id.*fingerprint/i);
    expect(await readFile(ledger, "utf8")).toBe(before);
  });

  it("rejects an indexed array getter without invoking it", async () => {
    let getterCalls = 0;
    const stamps: unknown[] = [];
    stamps.length = 1;
    Object.defineProperty(stamps, "0", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return VICTIM_STAMP;
      },
    });

    await expectAtomicRejection(stamps, /supersede.*array|accessor/i);
    expect(getterCalls).toBe(0);
  });

  it.each([
    [
      "sparse",
      () => {
        const stamps: unknown[] = [];
        stamps.length = 1;
        return stamps;
      },
    ],
    [
      "expando",
      () => Object.assign([VICTIM_STAMP], { unexpected: VICTIM_STAMP }),
    ],
    [
      "symbol",
      () => {
        const stamps = [VICTIM_STAMP];
        Object.defineProperty(stamps, Symbol("hostile"), {
          value: VICTIM_STAMP,
        });
        return stamps;
      },
    ],
  ] as const)("rejects a %s supersede array", async (_name, build) => {
    await expectAtomicRejection(build(), /supersede.*array/i);
  });

  it("bounds the outer supersede array before validating its members", async () => {
    const stamps = Array.from(
      { length: LEARNINGS_CONTRACT.maxEntries + 1 },
      (_unused, index) => ({
        id: `security-target-${index}`,
        fingerprint: `security-target-${index}`,
      })
    );
    await expectAtomicRejection(stamps, /supersede.*maxEntries|too many/i);
  });

  it.each(["id", "fingerprint"] as const)(
    "bounds the stamped %s before applying stable-token grammar",
    async field => {
      const stamp = {
        ...VICTIM_STAMP,
        // Uppercase is also outside the grammar, so the expected size error
        // proves the byte bound runs first.
        [field]: "A".repeat(MAX_STABLE_TOKEN_BYTES + 1),
      };
      await expectAtomicRejection(
        [stamp],
        new RegExp(
          `${field} exceeds max stable token bytes ${MAX_STABLE_TOKEN_BYTES}`,
          "i"
        )
      );
    }
  );

  it("rejects an accessor-backed stamp field without invoking it", async () => {
    let getterCalls = 0;
    const stamp = { fingerprint: VICTIM_STAMP.fingerprint } as Record<
      string,
      unknown
    >;
    Object.defineProperty(stamp, "id", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return VICTIM_STAMP.id;
      },
    });
    await expectAtomicRejection([stamp], /stamp id.*data string/i);
    expect(getterCalls).toBe(0);
  });

  it.each([
    ["extra", () => ({ ...VICTIM_STAMP, extra: true })],
    [
      "symbol",
      () => {
        const stamp = { ...VICTIM_STAMP };
        Object.defineProperty(stamp, Symbol("hostile"), { value: true });
        return stamp;
      },
    ],
  ] as const)("rejects a stamp with an own %s field", async (_name, build) => {
    await expectAtomicRejection([build()], /exactly.*id.*fingerprint/i);
  });
});
