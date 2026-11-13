/**
 * Behaviour contract: `lisa-persist-learning`'s documented Phase 1 command
 * keys every occurrence on the rule it will actually persist
 * (CodySwannGT/lisa#4643, item 5).
 *
 * The judge rewrites a planning miss into `Planning (<stage>): <check>` and
 * only that is persisted. A fingerprint taken from the submitted wording,
 * before the judge, gives two wordings of one rewritten check two keys — and
 * two learning PRs. So the fingerprint is computed after the judge, from the
 * rule the verdict carries, while the ledger's `learningFingerprint`
 * consolidation check stays as it was.
 *
 * The test extracts the bash block from the source skill's Phase 1 section
 * and runs it, so a broken command fails here. The prose around it is
 * guidance and is reviewed, not pinned (#4867).
 * @module tests/unit/strategies/persist-learning-post-judge-fingerprint-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

const FINGERPRINT_HEADING =
  "## Phase 1 — Fingerprint (stable dedupe key, after the judge)";

describe("the Phase 1 fingerprint command (source)", () => {
  const persist = readFileSync(
    path.resolve("plugins/src/base/skills/lisa-persist-learning/SKILL.md"),
    "utf8"
  );
  const phase = persist.slice(
    persist.indexOf(FINGERPRINT_HEADING),
    persist.indexOf("## Phase 2 — Route by disposition")
  );
  const command = /```bash\n([\s\S]*?)```/.exec(phase)?.[1] ?? "";

  /**
   * Run the documented command and return the fingerprint it computes.
   * @param fields - Candidate fields the command reads, as shell variables
   * @returns The `FP` value
   */
  const fingerprintOf = (fields: Record<string, string>): string =>
    boundedExecFileSync({
      label: "persist-learning fingerprint command",
      command: "/bin/bash",
      args: ["-c", `${command}\nprintf '%s' "$FP"`],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...fields },
    });

  it("gives two wordings of one rewritten check one key", () => {
    expect(command).not.toBe("");
    const shared = {
      PERSISTED_RULE: "Planning (decomposition): name the migration owner.",
      TRIGGERING_ISSUE: "owner/repo#1",
    };
    const first = fingerprintOf({ ...shared, RULE: "who owns migrations?" });
    const second = fingerprintOf({
      ...shared,
      RULE: "Nobody said who migrates",
    });
    expect(first).toMatch(/^sll4-[0-9a-f]{12}$/);
    expect(second).toBe(first);
    expect(fingerprintOf({ ...shared, FP: "sll4-000000000000" })).toBe(first);
    expect(
      fingerprintOf({ ...shared, TRIGGERING_ISSUE: "owner/repo#2" })
    ).not.toBe(first);
  });
});
