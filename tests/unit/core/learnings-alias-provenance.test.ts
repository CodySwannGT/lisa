/**
 * Provenance economics of the supersede alias (CodySwannGT/lisa#1997).
 *
 * The alias map lives inside the entry's own `provenance`, which is a capped
 * list — so two questions have to be settled and pinned, and neither is
 * observable from the happy path in `learnings-stable-ids`:
 *
 * 1. **What gets sacrificed when the cap binds?** Never the caller's evidence.
 *    An alias is a convenience for finding an entry by an old name; the
 *    caller's references are the reason the learning is believed at all.
 * 2. **Who may mint an alias?** Only the writer. An alias asserts "this write
 *    removed that entry", and a hand-written one would let any caller capture a
 *    reference to an entry it never touched.
 *
 * Split from `learnings-stable-ids.test.ts` when that file reached its 300-line
 * cap; these four cases share the provenance-economics theme.
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveLearningReference } from "../../../src/core/learnings-alias.js";
import { LEARNINGS_CONTRACT } from "../../../src/core/learnings-contract.js";
import {
  parseLearningsFile,
  persistConsolidatedLearning,
  persistLearningEntry,
} from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LEARNINGS_FILENAME = "PROJECT_LEARNINGS.md";
const ORIGINAL_ID = "learner-aaaa1111";
const SECOND_ID = "learner-bbbb2222";
const THIRD_ID = "learner-cccc3333";
// Literal on purpose: deriving these from buildSupersedesReference would
// mirror a format change instead of catching it.
const ORIGINAL_ALIAS = "supersedes:learner-aaaa1111";
const SECOND_ALIAS = "supersedes:learner-bbbb2222";
const FIRST_DATE = "2026-07-01";
const SECOND_DATE = "2026-07-02";
const THIRD_DATE = "2026-07-03";
const ORIGINAL_RULE = "Original rule.";
const SECOND_RULE = "Second rule.";

/**
 * Build a valid entry with caller-chosen id, date, and rule text.
 * @param id - Stable entry id
 * @param firstLearned - ISO `first_learned` (also used as `last_confirmed`)
 * @param rule - Rule text
 * @returns Valid seven-field entry
 */
function entryOf(id: string, firstLearned: string, rule: string) {
  return {
    id,
    rule,
    why: "Reason the rule exists.",
    provenance: [`issue:#${id}`],
    first_learned: firstLearned,
    last_confirmed: firstLearned,
    confidence: "high",
  } as const;
}

describe("supersede alias provenance economics", () => {
  let tempDir: string;
  let learningsPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    learningsPath = path.join(tempDir, ".lisa", LEARNINGS_FILENAME);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Read and parse the persisted ledger.
   * @returns Parsed entries
   */
  async function readEntries() {
    return parseLearningsFile(await readFile(learningsPath, "utf8"));
  }

  it("reports alias references dropped at a full provenance cap instead of failing the write", async () => {
    const dropped: string[][] = [];
    const crowded = {
      ...entryOf(SECOND_ID, SECOND_DATE, "Crowded rule."),
      provenance: Array.from(
        { length: LEARNINGS_CONTRACT.maxProvenanceReferences },
        (_unused, index) => `issue:#${index}`
      ),
    };
    await persistLearningEntry(
      tempDir,
      entryOf(ORIGINAL_ID, FIRST_DATE, ORIGINAL_RULE)
    );
    await persistConsolidatedLearning(tempDir, crowded, {
      supersede: [ORIGINAL_ID],
      onAliasesDropped: ids => dropped.push([...ids]),
    });
    const entries = await readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.provenance).toHaveLength(
      LEARNINGS_CONTRACT.maxProvenanceReferences
    );
    expect(dropped).toEqual([[ORIGINAL_ALIAS]]);
  });

  it("never evicts caller evidence to fit an alias, and keeps the OLDEST alias", async () => {
    // PARTIAL room is what makes this test discriminating. With a completely
    // full provenance list every eviction policy gives the same answer (drop
    // them all), so it cannot tell "drop newest" from "drop oldest" — nor can
    // it catch a writer that evicts the caller's own references to make room
    // while still reporting the alias as dropped. That last one is the real
    // hazard: it would silently delete the ticket links a learning rests on.
    //
    // 19 caller references + a 2-deep lineage leaves room for exactly ONE
    // alias, so the policy has to actually choose.
    const dropped: string[][] = [];
    const callerReferences = Array.from(
      { length: LEARNINGS_CONTRACT.maxProvenanceReferences - 1 },
      (_unused, index) => `issue:#evidence-${index}`
    );
    await persistLearningEntry(
      tempDir,
      entryOf(ORIGINAL_ID, FIRST_DATE, ORIGINAL_RULE)
    );
    await persistConsolidatedLearning(
      tempDir,
      entryOf(SECOND_ID, SECOND_DATE, SECOND_RULE),
      { supersede: [ORIGINAL_ID] }
    );
    await persistConsolidatedLearning(
      tempDir,
      {
        ...entryOf(THIRD_ID, THIRD_DATE, "Crowded consolidation."),
        provenance: callerReferences,
      },
      {
        supersede: [SECOND_ID],
        onAliasesDropped: ids => dropped.push([...ids]),
      }
    );

    const entries = await readEntries();
    expect(entries).toHaveLength(1);
    // Every one of the caller's references survives — evidence is never the
    // thing that gets sacrificed.
    expect(entries[0]?.provenance).toEqual([
      ...callerReferences,
      ORIGINAL_ALIAS,
    ]);
    // The OLDEST alias is the survivor: a months-old tracker comment citing
    // `ORIGINAL_ID` has no other way home, while `SECOND_ID` churned in this
    // very consolidation and is still discoverable from the branch.
    expect(resolveLearningReference(entries, ORIGINAL_ID)?.id).toBe(THIRD_ID);
    expect(resolveLearningReference(entries, SECOND_ID)).toBeUndefined();
    expect(dropped).toEqual([[SECOND_ALIAS]]);
  });

  it("rejects a caller-minted supersedes reference so aliases stay writer-owned", async () => {
    await persistLearningEntry(
      tempDir,
      entryOf(ORIGINAL_ID, FIRST_DATE, ORIGINAL_RULE)
    );
    await expect(
      persistLearningEntry(tempDir, {
        ...entryOf(THIRD_ID, THIRD_DATE, "Hijacking rule."),
        provenance: ["issue:#1997", ORIGINAL_ALIAS],
      })
    ).rejects.toThrow(/references are added by the writer, not the caller/);
    // The hijack attempt changed nothing: the original still owns its own id.
    const entries = await readEntries();
    expect(entries.map(entry => entry.id)).toEqual([ORIGINAL_ID]);
    expect(resolveLearningReference(entries, ORIGINAL_ID)?.rule).toBe(
      ORIGINAL_RULE
    );
  });

  it("still parses writer-added aliases back off disk", async () => {
    // The caller-side rejection must not make the contract unable to read its
    // own output: `validateLearningEntry` runs on every parsed entry and on
    // every merge side, where `supersedes:` references are legitimate.
    await persistLearningEntry(
      tempDir,
      entryOf(ORIGINAL_ID, FIRST_DATE, ORIGINAL_RULE)
    );
    await persistConsolidatedLearning(
      tempDir,
      entryOf(SECOND_ID, SECOND_DATE, SECOND_RULE),
      { supersede: [ORIGINAL_ID] }
    );
    const raw = await readFile(learningsPath, "utf8");
    expect(() => parseLearningsFile(raw)).not.toThrow();
    expect(parseLearningsFile(raw)[0]?.provenance).toContain(ORIGINAL_ALIAS);
  });
});
