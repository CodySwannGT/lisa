/** Stable identity and stamped supersede semantics for contract v2. */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveLearningReference,
  SUPERSEDES_PREFIX,
} from "../../../src/core/learnings-alias.js";
import {
  parseLearningsFile,
  persistConsolidatedLearning,
  persistLearningEntry,
} from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LEARNINGS_FILE = path.join(".lisa", "PROJECT_LEARNINGS.md");
const DATE = "2026-07-23";
const BASE = "learner-base";
const FIRST = "learner-first";
const SECOND = "learner-second";
const LEARNER_A = "learner-a";
const LEARNER_B = "learner-b";
const MERGED = "learner-merged";
const NEXT = "learner-next";
const SHARPER_RULE = "Sharper rule.";

/**
 * Build a valid entry whose initial public id is its content fingerprint.
 * @param fingerprint - Deterministic content-version token
 * @param rule - Rule text to persist
 * @returns Valid initial learning entry
 */
function entry(fingerprint: string, rule: string = `Rule ${fingerprint}.`) {
  return {
    id: fingerprint,
    fingerprint,
    rule,
    why: `Why ${fingerprint}.`,
    provenance: [`issue:#${fingerprint}`],
    first_learned: DATE,
    last_confirmed: DATE,
    confidence: "high",
  } as const;
}

/**
 * Capture the exact version of one parsed entry for a future write.
 * @param value - Parsed entry identity
 * @param value.id - Stable public identity
 * @param value.fingerprint - Observed content-version token
 * @returns Exact immutable stamp
 */
function stamp(value: { readonly id: string; readonly fingerprint: string }) {
  return { id: value.id, fingerprint: value.fingerprint } as const;
}

describe("stable ids with a persisted fingerprint version token", () => {
  let projectRoot: string;
  let file: string;

  beforeEach(async () => {
    projectRoot = await createTempDir();
    file = path.join(projectRoot, LEARNINGS_FILE);
  });

  afterEach(async () => {
    await cleanupTempDir(projectRoot);
  });

  /**
   * Read the current normalized ledger.
   * @returns Parsed current-schema entries
   */
  async function entries() {
    return parseLearningsFile(await readFile(file, "utf8"));
  }

  it("carries the exact target id forward while replacing its fingerprint", async () => {
    const base = entry(BASE);
    await persistLearningEntry(projectRoot, base);

    await persistConsolidatedLearning(projectRoot, entry(NEXT, SHARPER_RULE), {
      supersede: [stamp(base)],
    });

    expect(await entries()).toEqual([
      {
        ...entry(NEXT, SHARPER_RULE),
        id: BASE,
      },
    ]);
  });

  it("accepts a legitimate chained rewrite only with the current fingerprint", async () => {
    const base = entry(BASE);
    await persistLearningEntry(projectRoot, base);
    await persistConsolidatedLearning(projectRoot, entry(FIRST), {
      supersede: [stamp(base)],
    });
    const current = (await entries())[0]!;

    await persistConsolidatedLearning(projectRoot, entry(SECOND), {
      supersede: [stamp(current)],
    });

    expect(await entries()).toEqual([{ ...entry(SECOND), id: BASE }]);
  });

  it("preserves a stale writer as a safe append and reports the exact mismatch", async () => {
    const base = entry(BASE);
    await persistLearningEntry(projectRoot, base);
    const stale = stamp(base);
    await persistConsolidatedLearning(projectRoot, entry(FIRST), {
      supersede: [stale],
    });
    const reports: unknown[] = [];

    await persistConsolidatedLearning(projectRoot, entry(SECOND), {
      supersede: [stale],
      onStaleSupersede: targets => reports.push(targets),
    });

    const persisted = await entries();
    expect(persisted.map(value => value.id)).toEqual([BASE, SECOND]);
    expect(reports).toEqual([
      [
        {
          expected: stale,
          actualFingerprint: FIRST,
          reason: "fingerprint-mismatch",
        },
      ],
    ]);
    expect(
      persisted[1]?.provenance.some(value =>
        value.startsWith(SUPERSEDES_PREFIX)
      )
    ).toBe(false);
  });

  it("makes a partially stale multi-target rewrite all-or-nothing", async () => {
    const a = entry(LEARNER_A);
    const b = entry(LEARNER_B);
    await persistLearningEntry(projectRoot, a);
    await persistLearningEntry(projectRoot, b);
    await persistConsolidatedLearning(projectRoot, entry("learner-b-new"), {
      supersede: [stamp(b)],
    });

    await persistConsolidatedLearning(projectRoot, entry(MERGED), {
      supersede: [stamp(a), stamp(b)],
    });

    expect((await entries()).map(value => value.id)).toEqual([
      LEARNER_A,
      LEARNER_B,
      MERGED,
    ]);
  });

  it("chooses the lexicographically first exact target as multi-target primary", async () => {
    const z = entry("learner-z");
    const a = entry(LEARNER_A);
    await persistLearningEntry(projectRoot, z);
    await persistLearningEntry(projectRoot, a);

    await persistConsolidatedLearning(projectRoot, entry(MERGED), {
      supersede: [stamp(z), stamp(a)],
    });

    const [merged] = await entries();
    expect(merged?.id).toBe(LEARNER_A);
    expect(resolveLearningReference([merged!], "learner-z")?.id).toBe(
      LEARNER_A
    );
  });

  it("rejects a duplicate fingerprint before callbacks or bytes can change", async () => {
    const base = entry(BASE);
    await persistLearningEntry(projectRoot, base);
    const before = await readFile(file, "utf8");
    const staleReports: unknown[] = [];

    await expect(
      persistConsolidatedLearning(
        projectRoot,
        { ...entry("learner-other"), fingerprint: base.fingerprint },
        {
          supersede: [stamp(base)],
          onStaleSupersede: targets => staleReports.push(targets),
        }
      )
    ).rejects.toThrow(/duplicate.*fingerprint/i);

    expect(staleReports).toEqual([]);
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("rejects legacy string supersede directives before touching the ledger", async () => {
    const base = entry(BASE);
    await persistLearningEntry(projectRoot, base);
    const before = await readFile(file, "utf8");

    await expect(
      persistConsolidatedLearning(projectRoot, entry("learner-next"), {
        supersede: [base.id] as never,
      })
    ).rejects.toThrow(/stamp|fingerprint/i);
    expect(await readFile(file, "utf8")).toBe(before);
  });
});
