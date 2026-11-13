/**
 * Prose contract: `lisa-persist-learning` keys every occurrence marker,
 * branch and PR search on the rule it will actually persist
 * (CodySwannGT/lisa#4643, item 5).
 *
 * The judge rewrites a planning miss into `Planning (<stage>): <check>` and
 * only that is persisted. A fingerprint taken from the submitted wording,
 * before the judge, gives two wordings of one rewritten check two keys — and
 * two learning PRs. So the fingerprint is computed after the judge, from the
 * rule the verdict carries, while the ledger's `learningFingerprint`
 * consolidation check stays as it was.
 * @module tests/unit/strategies/persist-learning-post-judge-fingerprint-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

/** Every skill root a runtime reads: the source plus each projection. */
const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-devin/skills",
  "plugins/lisa/.codex-plugin/skills",
] as const;

const JUDGE_HEADING = "## Phase 0 — Judge (mandatory, never skipped)";
const FINGERPRINT_HEADING =
  "## Phase 1 — Fingerprint (stable dedupe key, after the judge)";

describe.each(SKILL_ROOTS)("post-judge occurrence fingerprint (%s)", root => {
  const persist = readFileSync(
    path.resolve(root, "lisa-persist-learning/SKILL.md"),
    "utf8"
  );
  const fingerprintPhase = persist.slice(
    persist.indexOf(FINGERPRINT_HEADING),
    persist.indexOf("## Phase 2 — Route by disposition")
  );

  it("runs the judge before it computes the fingerprint", () => {
    expect(persist.indexOf(JUDGE_HEADING)).toBeLessThan(
      persist.indexOf(FINGERPRINT_HEADING)
    );
  });

  it("fingerprints the rule the verdict carries, for every disposition", () => {
    expect(fingerprintPhase).toContain("the rule the verdict carries");
    expect(fingerprintPhase).toContain(
      "the judge's rewritten `Planning (<stage>): <check>` rule for a `planning-miss`"
    );
    expect(fingerprintPhase).toContain(
      "the submitted `rule` for every other classification"
    );
    expect(fingerprintPhase).toContain(
      "two wordings the judge rewrites to the same check share one fingerprint"
    );
    expect(fingerprintPhase).toContain(
      "NORM=$(printf '%s' \"$PERSISTED_RULE\""
    );
    expect(fingerprintPhase).not.toContain("printf '%s' \"$RULE\"");
  });

  it("keeps every marker, branch and PR search on that one fingerprint", () => {
    expect(fingerprintPhase).toContain(
      "Every marker, branch and PR search in Phases 2 and 3 uses this fingerprint"
    );
  });

  it("ignores a caller-supplied fingerprint", () => {
    expect(fingerprintPhase).toContain(
      "A caller-supplied `fingerprint` is ignored"
    );
  });

  it("leaves the ledger consolidation check on learningFingerprint", () => {
    expect(persist).toContain(
      "First compare `learningFingerprint(existing.rule)` with `learningFingerprint(candidate.rule)`"
    );
  });
});

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
