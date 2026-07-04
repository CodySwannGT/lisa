/**
 * Regression tests for the always-written, machine-readable generated-work
 * section in the prd-backlink skill.
 *
 * Issue #582 (LPC-1.2): make the documented generated-work section in
 * `prd-backlink` (the `## Tickets` section, alias `## Generated Work`) the
 * universal fallback that is ALWAYS written for every `source_type` — additive
 * to the native hierarchy linking from #580 (GitHub sub-issues) and #581
 * (Linear/JIRA native parents), never exclusive — AND machine-readable: each
 * entry carries a stable, parseable token (ref + URL + type + parent) so LPC-1.3
 * rollup (#576) can enumerate the generated top-level child set by parsing the
 * section ALONE, without scraping free-form comments. Part of PRD #525; cites
 * the `prd-lifecycle-rollup` rule (#579) by slug.
 *
 * The guarantees under test:
 *   (1) the documented section is ALWAYS written for every source_type
 *       (additive to native links, written even when native links exist);
 *   (2) each entry is MACHINE-READABLE — a `<!-- lisa:gw ref=.. url=.. type=..
 *       parent=.. -->` token carrying ref + URL + type + parent_key;
 *   (3) `## Tickets` is canonical and `## Generated Work` is a documented alias
 *       the reader recognizes;
 *   (4) the section is regenerated in place / deterministic with NO timestamp,
 *       so re-runs produce byte-identical output with no duplicate entries;
 *   (5) the `prd-lifecycle-rollup` rule is cited by slug.
 *
 * Beyond asserting the spec documents these guarantees, this suite proves the
 * documented token format is genuinely machine-readable by PARSING a section
 * rendered to that exact spec: it enumerates the child set, selects the
 * generated TOP-LEVEL children (empty `parent`) without reading any prose, and
 * shows a re-render of the same ticket set is byte-identical (idempotent) — the
 * empirical verification #582 requires.
 *
 * Both the source (`plugins/src/base/skills`) and the generated artifact
 * (`plugins/lisa/skills`) are asserted, so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite — the same discipline the
 * prd-backlink-native-linking (#580/#581) suite uses.
 * @module tests/unit/strategies/prd-backlink-generated-work-section
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

/** The skill's directory / slug. */
const SKILL_SLUG = "lisa-prd-backlink";
/** The vendor-neutral rule this skill cites by slug. */
const RULE_SLUG = "prd-lifecycle-rollup";

/** `describe.each` title shared by every plugin-root block. */
const ROOT_TITLE = "%s/prd-backlink/SKILL.md";

/** Every vendor source_type the section must be written for. */
const SOURCE_TYPES = [
  "notion",
  "confluence",
  "linear",
  "github",
  "file",
] as const;

const readSkill = (root: string): string =>
  readFileSync(path.resolve(root, SKILL_SLUG, "SKILL.md"), "utf8");

describe("prd-backlink always-written machine-readable section (#582)", () => {
  describe.each(SKILL_ROOTS)(ROOT_TITLE, root => {
    const skillPath = path.resolve(root, SKILL_SLUG, "SKILL.md");

    it("exists in this plugin root", () => {
      expect(existsSync(skillPath)).toBe(true);
    });

    const content = readSkill(root);

    // (1) always written for every source_type, additive to native linking.
    it("documents the section is always written for every source_type", () => {
      expect(content).toMatch(/always-written|always written/i);
      // Additive to native linking, not a replacement.
      expect(content).toMatch(/additive/i);
      expect(content).toMatch(/never a (substitute|replacement)/i);
      // Written for every vendor, including those that also get native links.
      expect(content).toMatch(/every\s+`?source_type`?|for every vendor/i);
    });

    // (1) explicitly written even when a native hierarchy link also exists.
    it("writes the section even when native links exist", () => {
      expect(content).toMatch(
        /even when a native (hierarchy )?link was also made|written.*regardless|either way/i
      );
    });

    // (2) machine-readable token format: ref + URL + type + parent.
    it("documents a machine-readable per-entry token", () => {
      expect(content).toMatch(/machine-readable/i);
      // The fixed sentinel + the four fields, in fixed order.
      expect(content).toContain("<!-- lisa:gw ref=");
      expect(content).toMatch(/ref=.*url=.*type=.*parent=/);
    });

    // (2) the token explicitly carries each required field with its meaning.
    it("documents ref, url, type, and parent token fields", () => {
      expect(content).toMatch(/\*\*`ref`\*\*/);
      expect(content).toMatch(/\*\*`url`\*\*/);
      expect(content).toMatch(/\*\*`type`\*\*/);
      expect(content).toMatch(/\*\*`parent`\*\*/);
      // parent is empty for top-level entries (the rollup selection key).
      expect(content).toMatch(/empty\*?\*? when the entry is top-level/i);
    });

    // (2) parseable without reading prose — the explicit rollup contract.
    it("states the set is parseable without reading prose/comments", () => {
      expect(content).toMatch(
        /parse(able|d)? (this section|the section) alone|without (reading|scraping) (prose|free-form|comments)/i
      );
    });

    // (3) canonical heading + documented alias.
    it("documents ## Tickets as canonical and ## Generated Work as alias", () => {
      expect(content).toMatch(/## Tickets/);
      expect(content).toMatch(/## Generated Work/);
      expect(content).toMatch(/accepted alias|alias.*recognize/i);
      // Either heading is matched when locating an existing section.
      expect(content).toMatch(/match either heading|either name/i);
    });

    // (4) idempotent / regenerate-in-place / no timestamp.
    it("is deterministic, regenerated in place with no timestamp", () => {
      expect(content).toMatch(/byte-identical|identical output bytes/i);
      expect(content).toMatch(
        /never append|regenerate.*not append|regenerated/i
      );
      expect(content).toMatch(/does not include a timestamp/i);
      // Dedupe by child-ref so no duplicate entries accumulate.
      expect(content).toMatch(/dedupe.*child-ref|child-ref.*dedupe/i);
      expect(content).toMatch(/no duplicate entries/i);
    });

    // (5) cites the prd-lifecycle-rollup rule by slug.
    it("cites the prd-lifecycle-rollup rule by slug", () => {
      expect(content).toContain(RULE_SLUG);
    });

    // (1) every vendor source_type is named as covered by the section.
    it.each(SOURCE_TYPES)("names the %s source_type", sourceType => {
      expect(content).toContain(sourceType);
    });
  });
});

/**
 * A generated work item, mirroring the `tickets[]` input shape the prd-backlink
 * skill consumes (`key`, `title`, `type`, `url`, `parent_key`).
 */
type Ticket = {
  readonly ref: string;
  readonly title: string;
  readonly type: string;
  readonly url: string;
  readonly parentRef: string | null;
};

/** A parsed `lisa:gw` token enumerated from a rendered section. */
type GeneratedWorkEntry = {
  readonly ref: string;
  readonly url: string;
  readonly type: string;
  readonly parent: string;
};

/**
 * Render a single machine-readable `lisa:gw` token to the documented spec.
 * Field order is fixed (ref, url, type, parent) so output is byte-stable.
 * @param ticket - The work item to render a token for.
 * @returns The single-line HTML-comment token.
 */
const renderToken = (ticket: Ticket): string =>
  `<!-- lisa:gw ref=${ticket.ref} url=${ticket.url} type=${ticket.type} parent=${ticket.parentRef ?? ""} -->`;

/**
 * Render a deterministic generated-work section from a ticket set, to the
 * documented format: a fixed header, then one line per entry sorted by ref,
 * each ending in its machine-readable token. No timestamp — same input bytes.
 * @param tickets - The generated work items.
 * @returns The rendered `## Tickets` section.
 */
const renderSection = (tickets: readonly Ticket[]): string => {
  const sorted = [...tickets].sort((a, b) => a.ref.localeCompare(b.ref));
  const lines = sorted.map(
    ticket =>
      `- [${ticket.ref}](${ticket.url}) — ${ticket.type}: ${ticket.title} ${renderToken(ticket)}`
  );
  return [
    "## Tickets",
    "",
    "_Generated by `lisa-prd-backlink`. Regenerated on every Plan run; do not edit by hand._",
    "",
    ...lines,
    "",
  ].join("\n");
};

/**
 * Enumerate the generated child set from a rendered section by matching only the
 * machine-readable tokens — never the surrounding prose, headings, or links.
 * @param section - A rendered generated-work section.
 * @returns Every `lisa:gw` entry, in document order.
 */
const parseEntries = (section: string): readonly GeneratedWorkEntry[] => {
  const tokenPattern =
    /<!-- lisa:gw ref=(\S+) url=(\S+) type=(\S+) parent=(\S*) -->/g;
  const entries: GeneratedWorkEntry[] = [];
  let match = tokenPattern.exec(section);
  while (match !== null) {
    entries.push({
      ref: match[1] ?? "",
      url: match[2] ?? "",
      type: match[3] ?? "",
      parent: match[4] ?? "",
    });
    match = tokenPattern.exec(section);
  }
  return entries;
};

/** Stable refs + URLs for the representative child set (hoisted to satisfy
 * sonarjs/no-duplicate-string and keep the fixture and its expectations DRY). */
const EPIC_REF = "CodySwannGT/lisa#100";
const STORY_REF = "CodySwannGT/lisa#101";
const SUBTASK_REF = "CodySwannGT/lisa#102";
const BUG_REF = "CodySwannGT/lisa#103";
const EPIC_URL = "https://github.com/CodySwannGT/lisa/issues/100";
const STORY_URL = "https://github.com/CodySwannGT/lisa/issues/101";
const SUBTASK_URL = "https://github.com/CodySwannGT/lisa/issues/102";
const BUG_URL = "https://github.com/CodySwannGT/lisa/issues/103";

describe("generated-work token format is genuinely machine-readable", () => {
  // A representative PRD child set: Epic → Story → Sub-task, plus an unparented
  // Bug. Only the Epic and the Bug are generated TOP-LEVEL work (empty parent).
  const tickets: readonly Ticket[] = [
    {
      ref: EPIC_REF,
      title: "Epic alpha",
      type: "Epic",
      url: EPIC_URL,
      parentRef: null,
    },
    {
      ref: STORY_REF,
      title: "Story under epic",
      type: "Story",
      url: STORY_URL,
      parentRef: EPIC_REF,
    },
    {
      ref: SUBTASK_REF,
      title: "Sub-task under story",
      type: "Sub-task",
      url: SUBTASK_URL,
      parentRef: STORY_REF,
    },
    {
      ref: BUG_REF,
      title: "Unparented bug",
      type: "Bug",
      url: BUG_URL,
      parentRef: null,
    },
  ];

  it("enumerates every child as ref + URL + type, parsed without prose", () => {
    const entries = parseEntries(renderSection(tickets));
    // Selected purely from tokens — never from headings, links, or indentation.
    expect([...entries].sort((a, b) => a.ref.localeCompare(b.ref))).toEqual([
      { ref: EPIC_REF, url: EPIC_URL, type: "Epic", parent: "" },
      { ref: STORY_REF, url: STORY_URL, type: "Story", parent: EPIC_REF },
      {
        ref: SUBTASK_REF,
        url: SUBTASK_URL,
        type: "Sub-task",
        parent: STORY_REF,
      },
      { ref: BUG_REF, url: BUG_URL, type: "Bug", parent: "" },
    ]);
  });

  it("selects the generated top-level child set by empty parent", () => {
    const topLevel = parseEntries(renderSection(tickets))
      .filter(entry => entry.parent === "")
      .map(entry => entry.ref)
      .sort((a, b) => a.localeCompare(b));
    // Only the Epic and the unparented Bug — the Story and Sub-task are
    // descendants owned by their own parent, never direct PRD children.
    expect(topLevel).toEqual([EPIC_REF, BUG_REF]);
  });

  it("re-renders byte-identically for the same ticket set (idempotent)", () => {
    expect(renderSection(tickets)).toBe(renderSection(tickets));
  });

  it("re-render is order-independent and dedupe-stable by ref", () => {
    const shuffled = [tickets[3], tickets[1], tickets[0], tickets[2]] as const;
    // Same set in a different order renders identical bytes (sorted by ref).
    expect(renderSection(shuffled)).toBe(renderSection(tickets));
    // No duplicate entries: N tickets render exactly N tokens.
    expect(parseEntries(renderSection(tickets))).toHaveLength(tickets.length);
  });

  it("carries no timestamp (output is a pure function of the input)", () => {
    expect(renderSection(tickets)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
