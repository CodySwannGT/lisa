/**
 * Regression tests for the `/lisa:verify-prd` command + skill scaffold — the
 * read/guard front-half of initiative-level PRD verification.
 *
 * Issue #597 (PRD #553, Story #590, Epic #587): create the verify-prd command +
 * skill scaffold and its read/guard front-half — resolve the PRD across vendors,
 * read its generated top-level child work set by CONSUMING the
 * `prd-lifecycle-rollup` contract (native hierarchy first, machine-readable
 * generated-work section fallback — never reimplementing child enumeration), and
 * confirm every required generated top-level work item is terminal before any
 * empirical verification begins. If any required top-level child is non-terminal,
 * the terminal-child guard STOPS, reports the incomplete child set, and leaves
 * the PRD at `shipped`.
 *
 * The guarantees under test:
 *   (1) commands/verify-prd.md is a pass-through with `argument-hint: "<prd>"`
 *       that delegates to the /lisa:verify-prd skill;
 *   (2) the skill resolves the PRD vendor and reads the generated child set via
 *       the #525/#562 child-linking + machine-readable generated-work section,
 *       and explicitly does NOT reimplement child enumeration;
 *   (3) the terminal-child guard applies the per-vendor terminal predicate to
 *       generated TOP-LEVEL work only (excluding leaf sub-tasks), and on any
 *       non-terminal required child STOPS, reports the incomplete set, runs no
 *       verification, and leaves the PRD at `shipped`;
 *   (4) the scaffold cites `prd-lifecycle-rollup` by slug and scopes the PASS
 *       path / FAIL path / idempotency to sibling work (#598/#599/#600);
 *   (5) the front-half is read-only and does not re-prompt once invoked.
 *
 * Beyond asserting the scaffold documents these guarantees, this suite proves
 * the guard's selection + verdict logic is genuinely derivable from the contract
 * verify-prd consumes: it parses a `lisa:gw` generated-work section, selects the
 * generated TOP-LEVEL child set (empty `parent`), applies the GitHub terminal
 * predicate, and computes GUARD_BLOCKED vs GUARD_PASSED — the empirical trace
 * #597's terminal-child-guard evidence required (PRD #525 → top-level Epic #562
 * OPEN → GUARD_BLOCKED).
 *
 * Both plugin roots are asserted (`plugins/src/base` source of truth and the
 * generated `plugins/lisa` artifact), so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite — the same discipline the
 * prd-verified-lifecycle-docs (#592) and prd-backlink (#582) suites use.
 * @module tests/unit/strategies/verify-prd-scaffold
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The vendor-neutral rule the scaffold cites by slug. */
const RULE_SLUG = "prd-lifecycle-rollup";

/** Relative path of the pass-through command within a plugin root. */
const COMMAND_REL = "commands/verify-prd.md";
/** Relative path of the skill within a plugin root. */
const SKILL_REL = "skills/verify-prd/SKILL.md";

/** Source vendors the skill resolves, the same set prd-ticket-coverage lists. */
const SOURCE_VENDORS = [
  "GitHub",
  "Linear",
  "Notion",
  "Confluence",
  "JIRA",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("verify-prd scaffold (#597)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    const commandPath = path.resolve(root, COMMAND_REL);
    const skillPath = path.resolve(root, SKILL_REL);

    it("ships both the command and the skill in this plugin root", () => {
      expect(existsSync(commandPath)).toBe(true);
      expect(existsSync(skillPath)).toBe(true);
    });

    describe("commands/verify-prd.md", () => {
      const command = read(root, COMMAND_REL);

      it("is a pass-through with argument-hint that delegates to the skill", () => {
        // Pass-through command frontmatter: description + argument-hint "<prd>".
        expect(command).toMatch(/^---/);
        expect(command).toMatch(/description:/);
        expect(command).toContain('argument-hint: "<prd>"');
        // Body delegates to the /lisa:verify-prd skill and forwards $ARGUMENTS.
        expect(command).toMatch(/Use the \/lisa:verify-prd skill/);
        expect(command).toContain("$ARGUMENTS");
      });
    });

    describe("skills/verify-prd/SKILL.md", () => {
      const skill = read(root, SKILL_REL);

      it("declares frontmatter name, description, and allowed-tools", () => {
        expect(skill).toMatch(/^---/);
        expect(skill).toMatch(/name:\s*verify-prd/);
        expect(skill).toMatch(/description:/);
        expect(skill).toMatch(/allowed-tools:/);
        // The vendor read surfaces it resolves (Skill/Bash plus MCP readers).
        expect(skill).toContain("Skill");
        expect(skill).toContain("Bash");
      });

      // (2) resolves the PRD vendor the same way prd-ticket-coverage does.
      it("resolves the PRD ref and detects the source vendor", () => {
        expect(skill).toMatch(/detect (the )?(source )?vendor/i);
        // Resolves the same way prd-ticket-coverage / prd-backlink do.
        expect(skill).toMatch(/prd-ticket-coverage/);
        expect(skill).toMatch(/prd-backlink/);
      });

      it.each(SOURCE_VENDORS)("names the %s source vendor", vendor => {
        expect(skill).toContain(vendor);
      });

      // (2) reads the child set via the #525/#562 child-linking + generated-work
      //     section, and does NOT reimplement enumeration.
      it("reads the generated child set via the rollup contract without reimplementing it", () => {
        // Consumes the always-written machine-readable generated-work tokens.
        expect(skill).toContain("lisa:gw");
        expect(skill).toMatch(/## Tickets|## Generated Work/);
        // Two-source read: native hierarchy primary, documented section fallback.
        expect(skill).toMatch(/native (hierarchy|sub-issues)/i);
        // Explicitly forbids reimplementing child enumeration.
        expect(skill).toMatch(
          /(do|does) not reimplement (child )?enumeration/i
        );
        // Dedupe by child-ref identity (the rollup idempotency key).
        expect(skill).toMatch(/child-ref/i);
      });

      it("consumes tracker-read for the PRD/ticket read", () => {
        expect(skill).toMatch(/tracker-read/);
      });

      // (3) terminal predicate applies to generated TOP-LEVEL work only.
      it("applies the terminal predicate to top-level work, excluding leaf sub-tasks", () => {
        expect(skill).toMatch(/terminal/i);
        // Top-level only — leaf sub-tasks are excluded per the rollup contract.
        expect(skill).toMatch(/top-level/i);
        expect(skill).toMatch(/exclud(e|ing)[^]*sub-task/i);
        // Terminal-but-dropped (not-planned / canceled) is excluded from required.
        expect(skill).toMatch(/terminal-but-dropped/i);
        expect(skill).toMatch(/not.?planned|not_planned|canceled/i);
      });

      // (3) terminal-child guard: STOP, report, no verification, leave at shipped.
      it("the terminal-child guard stops without verifying and leaves the PRD at shipped", () => {
        expect(skill).toContain("STOP");
        // Reports the incomplete child set.
        expect(skill).toMatch(/incomplete child set/i);
        // Does NOT run empirical verification.
        expect(skill).toMatch(/do(es)? not run empirical verification/i);
        // Leaves the PRD lifecycle untouched — stays at shipped.
        expect(skill).toMatch(/stays at .?shipped.?|left at .?shipped.?/i);
        expect(skill).toMatch(/untouched|do not transition/i);
      });

      // (4) cites the rule by slug; PASS/FAIL/idempotency are sibling work.
      it("cites prd-lifecycle-rollup by slug and scopes the rest to siblings", () => {
        expect(skill).toContain(RULE_SLUG);
        expect(skill).toMatch(/cite[^]*by slug|cites the rule by slug/i);
        expect(skill).toMatch(/out of scope/i);
        // The PASS path, FAIL path, and idempotency are sibling work.
        expect(skill).toMatch(/PASS path/i);
        expect(skill).toMatch(/FAIL path/i);
        expect(skill).toMatch(/idempoten/i);
        expect(skill).toMatch(/shipped → verified/);
        expect(skill).toMatch(/shipped → blocked/);
      });

      // (5) read-only front-half that does not re-prompt.
      it("is a read-only front-half and does not re-prompt once invoked", () => {
        // Tolerate markdown emphasis around "not" (e.g. "Do **not** re-prompt").
        expect(skill).toMatch(/do(es)?\s+\**not\**\s+re-prompt/i);
        expect(skill).toMatch(/read-only/i);
      });
    });
  });
});

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
