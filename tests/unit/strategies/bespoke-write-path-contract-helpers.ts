/**
 * Contract table for the bespoke-tracker-write-path obligation
 * (CodySwannGT/lisa#3663).
 *
 * A team that writes to its tracker through its own script gets neither the
 * pre-write validate gate nor the post-write verify gate that the vendor write
 * skills run, and the script's own read-back proves transport rather than
 * quality. The remedy is prose in the contracts themselves, so the table below
 * names the phrases each contract must carry and the assertion logic is shared
 * between the test and any driver that wants to run it against a different
 * revision of the same files.
 * @module tests/unit/strategies/bespoke-write-path-contract-helpers
 */

/** Which half of the two-phase gate a skill file is a contract for. */
export type SkillKind = "write" | "validator" | "verify";

/** One skill whose SKILL.md must carry a set of contract phrases. */
export interface ContractTarget {
  /** Which half of the gate this skill documents. */
  readonly kind: SkillKind;
  /** Skill directory name, e.g. `lisa-linear-write-issue`. */
  readonly skill: string;
  /** Literal substrings that must all appear in the skill body. */
  readonly phrases: readonly string[];
}

/**
 * Every plugin root that ships a copy of a base skill. `plugins/src/base` is
 * the editable source; the rest are regenerated from it by `build:plugins`, so
 * a phrase present in one and absent from another is a fan-out failure.
 */
export const SKILL_ROOTS: readonly string[] = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
];

/**
 * The discoverability clause. An agent that searches the repository it is
 * standing in finds no shell script and concludes the capability is absent;
 * both the write contract and the validator contract have to say otherwise.
 */
const PLUGIN_RESIDENT_CLAUSE =
  "expected to appear in any repository's `scripts/` directory";

const WRITE_PHRASES: readonly string[] = [
  "Writing by a bespoke path",
  "proves transport, not quality",
  "Pre-write validate",
  "Post-write verify",
  "Three outcomes, never two",
  PLUGIN_RESIDENT_CLAUSE,
];

const VALIDATOR_PHRASES: readonly string[] = [
  "Standalone entry point",
  "supported entry point in its own right",
  PLUGIN_RESIDENT_CLAUSE,
];

const VERIFY_PHRASES: readonly string[] = [
  "semantic, never byte-exact",
  "normalizes markdown on write",
  "Byte-exact comparison of such text is forbidden",
];

/**
 * The AC grep from CodySwannGT/lisa#3663 reproduction step 3, transcribed. It
 * returned zero hits in all three write skills at commit 687ee7ba8.
 */
export const BESPOKE_PATH_PATTERN = /bespoke|direct (graphql|api)|own script/iu;

/** Every skill file that carries part of this contract, with its phrases. */
export const CONTRACT_TARGETS: readonly ContractTarget[] = [
  { kind: "write", skill: "lisa-linear-write-issue", phrases: WRITE_PHRASES },
  { kind: "write", skill: "lisa-jira-write-ticket", phrases: WRITE_PHRASES },
  { kind: "write", skill: "lisa-github-write-issue", phrases: WRITE_PHRASES },
  {
    kind: "validator",
    skill: "lisa-linear-validate-issue",
    phrases: VALIDATOR_PHRASES,
  },
  {
    kind: "validator",
    skill: "lisa-jira-validate-ticket",
    phrases: VALIDATOR_PHRASES,
  },
  {
    kind: "validator",
    skill: "lisa-github-validate-issue",
    phrases: VALIDATOR_PHRASES,
  },
  { kind: "verify", skill: "lisa-linear-verify", phrases: VERIFY_PHRASES },
  { kind: "verify", skill: "lisa-jira-verify", phrases: VERIFY_PHRASES },
  { kind: "verify", skill: "lisa-github-verify", phrases: VERIFY_PHRASES },
];

/**
 * Repository-relative paths of every shipped copy of a skill.
 * @param skill - Skill directory name.
 * @returns One path per plugin root, in `SKILL_ROOTS` order.
 */
export function skillPaths(skill: string): readonly string[] {
  return SKILL_ROOTS.map(root => `${root}/${skill}/SKILL.md`);
}

/**
 * Collapses every whitespace run to a single space so a phrase still matches
 * when prose wraps across a line break. The contract is about what a contract
 * says, not about where its lines happen to end.
 * @param text - Text to normalize.
 * @returns The text with whitespace runs collapsed and ends trimmed.
 */
function collapseWhitespace(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

/**
 * Contract phrases a body is missing.
 * @param body - Full text of a SKILL.md.
 * @param target - The contract target the body is supposed to satisfy.
 * @returns The phrases absent from the body, in declaration order.
 */
export function missingPhrases(
  body: string,
  target: ContractTarget
): readonly string[] {
  const normalized = collapseWhitespace(body);
  return target.phrases.filter(
    phrase => !normalized.includes(collapseWhitespace(phrase))
  );
}

/**
 * Whether a write-skill body would satisfy the issue's reproduction grep.
 * @param body - Full text of a write skill's SKILL.md.
 * @returns True when the bespoke-path search finds at least one hit.
 */
export function matchesBespokePathSearch(body: string): boolean {
  return BESPOKE_PATH_PATTERN.test(body);
}
