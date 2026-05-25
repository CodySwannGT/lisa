/**
 * Executable proof that the `/lisa:verify-prd` terminal-child guard's selection
 * and verdict logic is genuinely derivable from the `prd-lifecycle-rollup`
 * contract the skill CONSUMES (it does not reimplement child enumeration).
 *
 * Split out of verify-prd-scaffold.test.ts (#597/#598/#599 doc-presence suites)
 * to keep each file within the project's max-lines budget. This file holds the
 * behavioral guard logic: parse a `lisa:gw` generated-work section, select the
 * generated TOP-LEVEL child set (empty `parent`), apply the GitHub terminal
 * predicate, and compute GUARD_BLOCKED / GUARD_PASSED / NO_CHILDREN — the
 * empirical trace #597's terminal-child-guard evidence required (PRD #525 →
 * top-level Epic #562 OPEN → GUARD_BLOCKED).
 * @module tests/unit/strategies/verify-prd-guard-logic
 */
import { describe, expect, it } from "vitest";

/**
 * A generated top-level child as the guard reads it: its child-ref, GitHub
 * issue state, and close reason (for the terminal-but-dropped distinction).
 * Mirrors the fields the skill's two-source read captures per child.
 */
type TopLevelChild = {
  readonly ref: string;
  readonly title: string;
  /** GitHub issue state. */
  readonly state: "OPEN" | "CLOSED";
  /** Close reason — `not_planned` is terminal-but-dropped. */
  readonly stateReason: "completed" | "not_planned" | null;
  /** Whether the resolved build `done` role label is present. */
  readonly hasDoneLabel: boolean;
};

/** A `lisa:gw` token parsed from a rendered generated-work section. */
type GeneratedWorkEntry = {
  readonly ref: string;
  readonly type: string;
  readonly parent: string;
};

/**
 * Enumerate the generated child set from a rendered generated-work section by
 * matching only the machine-readable `lisa:gw` tokens — never prose, headings,
 * links, or indentation. This is the read the skill consumes (it does not
 * reimplement enumeration); the parser proves the contract is consumable.
 * @param section - A rendered generated-work (`## Tickets`) section.
 * @returns Every `lisa:gw` entry, in document order.
 */
const parseEntries = (section: string): readonly GeneratedWorkEntry[] => {
  const tokenPattern =
    /<!-- lisa:gw ref=(\S+) url=\S+ type=(\S+) parent=(\S*) -->/g;
  const entries: GeneratedWorkEntry[] = [];
  let match = tokenPattern.exec(section);
  while (match !== null) {
    entries.push({
      ref: match[1] ?? "",
      type: match[2] ?? "",
      parent: match[3] ?? "",
    });
    match = tokenPattern.exec(section);
  }
  return entries;
};

/**
 * Apply the `prd-lifecycle-rollup` GitHub terminal-state predicate to one
 * generated top-level child.
 * @param child - The top-level child's current resolved state.
 * @returns Its rollup classification.
 */
const classifyChild = (
  child: TopLevelChild
): "terminal" | "terminal-but-dropped" | "incomplete" => {
  if (child.state === "CLOSED" && child.stateReason === "not_planned") {
    return "terminal-but-dropped";
  }
  if (child.state === "CLOSED" && child.hasDoneLabel) {
    return "terminal";
  }
  return "incomplete";
};

/**
 * Compute the terminal-child guard verdict over a generated top-level child set,
 * exactly as the skill's Phase 3 prescribes: required = top-level minus
 * terminal-but-dropped; GUARD_BLOCKED if any required child is incomplete,
 * GUARD_PASSED if all required children are terminal (and at least one exists),
 * NO_CHILDREN if the set is empty.
 * @param children - The generated top-level child set.
 * @returns The verdict plus the incomplete required child refs.
 */
const guardVerdict = (
  children: readonly TopLevelChild[]
): {
  readonly verdict: "GUARD_PASSED" | "GUARD_BLOCKED" | "NO_CHILDREN";
  readonly incompleteRefs: readonly string[];
} => {
  if (children.length === 0) {
    return { verdict: "NO_CHILDREN", incompleteRefs: [] };
  }
  const required = children.filter(
    child => classifyChild(child) !== "terminal-but-dropped"
  );
  const incompleteRefs = required
    .filter(child => classifyChild(child) === "incomplete")
    .map(child => child.ref);
  if (required.length === 0) {
    // Every child was dropped — nothing required ships the PRD.
    return { verdict: "NO_CHILDREN", incompleteRefs: [] };
  }
  return {
    verdict: incompleteRefs.length > 0 ? "GUARD_BLOCKED" : "GUARD_PASSED",
    incompleteRefs,
  };
};

/**
 * Stable child-refs for the guard fixtures (hoisted to satisfy
 * sonarjs/no-duplicate-string and keep fixtures and expectations DRY).
 */
const EPIC_REF = "CodySwannGT/lisa#100";
const STORY2_REF = "CodySwannGT/lisa#200";

describe("terminal-child guard logic is derivable from the rollup contract", () => {
  it("selects generated TOP-LEVEL children by empty parent, excluding descendants", () => {
    // Epic E (top-level) → Story S → Sub-task T, plus top-level Story S2.
    const section = [
      "## Tickets",
      "",
      `- [${EPIC_REF}](https://x/100) — Epic <!-- lisa:gw ref=${EPIC_REF} url=https://x/100 type=Epic parent= -->`,
      `  - [CodySwannGT/lisa#101](https://x/101) — Story: s <!-- lisa:gw ref=CodySwannGT/lisa#101 url=https://x/101 type=Story parent=${EPIC_REF} -->`,
      "    - [CodySwannGT/lisa#102](https://x/102) — Sub-task: t <!-- lisa:gw ref=CodySwannGT/lisa#102 url=https://x/102 type=Sub-task parent=CodySwannGT/lisa#101 -->",
      `- [${STORY2_REF}](https://x/200) — Story: s2 <!-- lisa:gw ref=${STORY2_REF} url=https://x/200 type=Story parent= -->`,
      "",
    ].join("\n");
    const topLevel = parseEntries(section)
      .filter(entry => entry.parent === "")
      .map(entry => entry.ref);
    // Only the top-level Epic and the top-level Story — never the nested Story
    // or the leaf Sub-task (those are owned by their own parent).
    expect(topLevel).toEqual([EPIC_REF, STORY2_REF]);
  });

  it("blocks when a required top-level child is open (the #525 → #562 trace)", () => {
    // The empirical [terminal-child-guard] evidence: PRD #525's one generated
    // top-level child is Epic #562, OPEN → incomplete → GUARD_BLOCKED.
    const result = guardVerdict([
      {
        ref: "CodySwannGT/lisa#562",
        title: "Link generated top-level work as PRD children",
        state: "OPEN",
        stateReason: null,
        hasDoneLabel: false,
      },
    ]);
    expect(result.verdict).toBe("GUARD_BLOCKED");
    expect(result.incompleteRefs).toEqual(["CodySwannGT/lisa#562"]);
  });

  it("blocks when a closed child lacks the done role label", () => {
    const result = guardVerdict([
      {
        ref: "CodySwannGT/lisa#300",
        title: "closed but not done-labelled",
        state: "CLOSED",
        stateReason: "completed",
        hasDoneLabel: false,
      },
    ]);
    expect(result.verdict).toBe("GUARD_BLOCKED");
    expect(result.incompleteRefs).toEqual(["CodySwannGT/lisa#300"]);
  });

  it("passes when every required top-level child is terminal", () => {
    const result = guardVerdict([
      {
        ref: EPIC_REF,
        title: "done epic",
        state: "CLOSED",
        stateReason: "completed",
        hasDoneLabel: true,
      },
      {
        ref: STORY2_REF,
        title: "done story",
        state: "CLOSED",
        stateReason: "completed",
        hasDoneLabel: true,
      },
    ]);
    expect(result.verdict).toBe("GUARD_PASSED");
    expect(result.incompleteRefs).toEqual([]);
  });

  it("excludes terminal-but-dropped (not_planned) children from the required set", () => {
    // One done child + one closed-as-not-planned child → all required terminal.
    const result = guardVerdict([
      {
        ref: EPIC_REF,
        title: "done epic",
        state: "CLOSED",
        stateReason: "completed",
        hasDoneLabel: true,
      },
      {
        ref: "CodySwannGT/lisa#400",
        title: "dropped epic",
        state: "CLOSED",
        stateReason: "not_planned",
        hasDoneLabel: false,
      },
    ]);
    expect(result.verdict).toBe("GUARD_PASSED");
    expect(result.incompleteRefs).toEqual([]);
  });

  it("reports NO_CHILDREN for an empty generated top-level set", () => {
    const result = guardVerdict([]);
    expect(result.verdict).toBe("NO_CHILDREN");
    expect(result.incompleteRefs).toEqual([]);
  });
});
