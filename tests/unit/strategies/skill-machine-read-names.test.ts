/**
 * Names that shipped code reads or emits, pinned in the documents that tell an
 * agent to use them (CodySwannGT/lisa#4867).
 *
 * The Markdown-assertion cull removed every check that only pinned wording. An
 * audit of the cull found a handful of deleted assertions that pinned NAMES
 * code depends on — a config key the review prover reads, the prover's own
 * output fields, a marker CI parses, shell variables the next line of the same
 * snippet uses. Rewording the prose around them is fine; renaming or dropping
 * one of these breaks the instruction without failing anything else. Each is
 * checked as the bare name, so this test pins the contract and not the prose.
 * @module tests/unit/strategies/skill-machine-read-names
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BASE = path.resolve(import.meta.dirname, "../../../plugins/src/base");

/**
 * Read a document under plugins/src/base.
 * @param relative - Path below plugins/src/base
 * @returns The file's text
 */
const read = (relative: string): string =>
  readFileSync(path.join(BASE, relative), "utf8");

/** The review prover, which reads the config key and emits the fields. */
const PROVER = "check-third-party-review-evidence.mjs";
const PROVER_ARM = `${PROVER} --arm output`;
const PROVER_OUTCOMES = `EVIDENCE_OUTCOMES in ${PROVER}`;
const WORK_ITEM = "lisa-work-item.mjs";

/** Every document, and the names it must carry, with who reads each name. */
const CONTRACT: ReadonlyArray<{
  readonly doc: string;
  readonly names: ReadonlyArray<readonly [name: string, readBy: string]>;
}> = [
  {
    doc: "skills/lisa-drive-pr-to-merge/SKILL.md",
    names: [
      ["evidence.reviewer", `${PROVER}, lisa-gates.mjs`],
      ["`arm`", PROVER_ARM],
      ["`action`", PROVER_ARM],
      ["`satisfied`", PROVER_OUTCOMES],
      ["`substituted`", PROVER_OUTCOMES],
      ['basis: "substitute"', `${PROVER} output`],
      ["arm: true", PROVER_ARM],
      ["violations[].kind", `${PROVER} output`],
      ["<!-- lisa:review-substitute", `${PROVER} marker parser`],
      ["deploy.branches", WORK_ITEM],
    ],
  },
  {
    doc: "rules/reference/leaf-only-lifecycle.md",
    names: [["deploy.branches", WORK_ITEM]],
  },
  ...[
    "skills/lisa-github-build-intake/SKILL.md",
    "skills/lisa-repair-intake/SKILL.md",
  ].map(doc => ({
    doc,
    names: [
      ["TRUST_DIR=$(mktemp -d)", "the trap and input path in the same snippet"],
      [
        '"$TRUST_DIR/input.json"',
        "the trust classifier invocation in the same snippet",
      ],
    ] as const,
  })),
];

describe("documents carry the names shipped code reads", () => {
  for (const { doc, names } of CONTRACT) {
    describe(doc, () => {
      const text = read(doc);
      it.each(names)("carries %s (read by %s)", name => {
        expect(text).toContain(name);
      });
    });
  }
});
