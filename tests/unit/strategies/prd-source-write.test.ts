/**
 * Regression tests for the PRD-source-write surface and the persona-driven
 * project-ideation -> research -> PRD creation chain.
 *
 * Design (co-designed with the codex CLI): `lisa:prd-source-write` is the PRD-side
 * sibling of `lisa:tracker-write` — a thin vendor-neutral dispatcher that reads
 * `source` and routes to a per-vendor PRD writer (`notion-write-prd`,
 * `confluence-write-prd`, `github-write-prd`, `linear-write-prd`). Each writer
 * creates (or idempotently updates) the PRD in the source with an `initial_role`
 * of `draft` (default) or `ready` (prd-ready), deduping by a stable body marker
 * matched by marker (never title). `research` synthesizes the PRD then creates it
 * in the source via the shim — there is no loose document artifact.
 * `project-ideation` derives evidence-gated personas, ideates per persona, and
 * chains selected build-ready ideas into `research` with `prd_ready`.
 *
 * Both source (`plugins/src/base/skills`) and generated artifact
 * (`plugins/lisa/skills`) roots are asserted so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/prd-source-write
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source + generated roots for base-plugin skills. */
const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

/** The PRD-side dispatcher skill name, referenced by callers and writers. */
const SHIM = "lisa:prd-source-write";
/** The role-control input every writer honors. */
const INITIAL_ROLE = "initial_role";
/** The stable ideation dedupe marker prefix. */
const IDEATION_MARKER = "[lisa-project-ideation]";

/**
 * Read a skill's SKILL.md from a root.
 * @param root plugin skills root
 * @param skill skill directory name
 * @returns SKILL.md contents
 */
const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

describe("prd-source-write shim", () => {
  describe.each(ROOTS)("%s", root => {
    const content = readSkill(root, "prd-source-write");

    it("reads source from config and fails loudly for jira and unknown sources", () => {
      expect(content).toMatch(/\.source/);
      expect(content).toMatch(/source=jira is not a supported PRD source/i);
      expect(content).toMatch(/notion, confluence, github, linear/);
    });

    it("dispatches to each per-vendor PRD writer", () => {
      expect(content).toContain("lisa:notion-write-prd");
      expect(content).toContain("lisa:confluence-write-prd");
      expect(content).toContain("lisa:github-write-prd");
      expect(content).toContain("lisa:linear-write-prd");
    });

    it("accepts initial_role with draft default and ready opt-in", () => {
      expect(content).toContain(INITIAL_ROLE);
      expect(content).toMatch(/default.*draft|omitted means `?draft`?/i);
      expect(content).toMatch(/ready.*picked up|picked up.*ready/i);
    });

    it("delegates idempotency (marker dedupe) to the vendor writers", () => {
      expect(content).toMatch(/marker/i);
      expect(content).toMatch(/dedupe/i);
    });

    it("forwards the ideation ledger payload without vendor-specific rendering", () => {
      expect(content).toContain("ideation_ledger_payload");
      expect(content).toMatch(
        /Forward\s+the object verbatim|pass-through payload/i
      );
      expect(content).toMatch(/Never drop, rename, or vendor-render/i);
    });
  });
});

describe("per-vendor PRD writers", () => {
  const WRITERS = [
    "notion-write-prd",
    "confluence-write-prd",
    "github-write-prd",
    "linear-write-prd",
  ] as const;

  describe.each(WRITERS)("%s", writer => {
    describe.each(ROOTS)("%s", root => {
      const content = readSkill(root, writer);

      it("is invoked behind the prd-source-write shim", () => {
        expect(content).toContain(SHIM);
      });

      it("applies the draft/ready lifecycle role from initial_role", () => {
        expect(content).toContain(INITIAL_ROLE);
        expect(content).toMatch(/draft/);
        expect(content).toMatch(/ready/);
      });

      it("dedupes by a stable marker, never by title/name", () => {
        expect(content).toMatch(/marker/i);
        expect(content).toMatch(/never by (title|name|project name)/i);
      });

      it("never down-ranks a PRD already past ready", () => {
        expect(content).toMatch(/past `?ready`?/i);
      });

      it("resolves the FULL PRD lifecycle vocabulary, not just draft/ready", () => {
        for (const role of [
          "in_review",
          "blocked",
          "ticketed",
          "shipped",
          "verified",
        ]) {
          expect(content).toMatch(new RegExp(role));
        }
      });

      it("normalizes the marker on both paths (no markerless body on update)", () => {
        expect(content).toMatch(/both paths/i);
        // Phrase can wrap across lines in the prose; tolerate whitespace.
        expect(content).toMatch(/never write\s+a markerless/i);
      });

      it("returns a structured created|reused result", () => {
        expect(content).toMatch(/outcome:.*created.*reused|created \| reused/);
      });
    });
  });

  // Per-vendor specifics: each writer uses the right substrate + state mechanism.
  describe.each(ROOTS)("github-write-prd specifics (%s)", root => {
    const content = readSkill(root, "github-write-prd");
    it("uses gh and applies exactly one prd lifecycle label", () => {
      expect(content).toMatch(/gh issue create/);
      expect(content).toMatch(/prd-draft/);
      expect(content).toMatch(/prd-ready/);
      expect(content).toMatch(/exactly one/i);
    });

    it("persists an exploratory ideation run ledger on create and reuse", () => {
      expect(content).toContain("## Exploratory Ideation Run Ledger");
      expect(content).toContain("lisa:exploratory-ideation-run-ledger:start");
      for (const field of [
        "timestamp",
        "automation_id",
        "repo",
        "prd_ready",
        "persona_evidence_refs",
        "selected_idea",
        "dedupe_marker",
        "prd_url",
        "outcome",
        "lifecycle_role_after_write",
        "rejected_overlap_candidates",
        "expected_empirical_verification_artifact",
      ]) {
        expect(content).toContain(field);
      }
      expect(content).toMatch(/outcome: created/);
      expect(content).toMatch(/outcome: reused/);
      expect(content).toMatch(/do not downgrade/i);
    });
  });

  describe.each(ROOTS)("linear-write-prd specifics (%s)", root => {
    const content = readSkill(root, "linear-write-prd");
    it("creates a Linear Project with one prd lifecycle project-label", () => {
      expect(content).toContain("save_project");
      expect(content).toMatch(/prd-ready/);
      expect(content).toMatch(/exactly one/i);
    });
  });

  describe.each(ROOTS)("notion-write-prd specifics (%s)", root => {
    const content = readSkill(root, "notion-write-prd");
    it("goes through notion-access create-page and sets the Status role", () => {
      expect(content).toContain("lisa:notion-access");
      expect(content).toContain("create-page");
      expect(content).toMatch(/Status/);
    });
  });

  describe.each(ROOTS)("confluence-write-prd specifics (%s)", root => {
    const content = readSkill(root, "confluence-write-prd");
    it("goes through atlassian-access and models state by parent page", () => {
      expect(content).toContain("lisa:atlassian-access");
      expect(content).toMatch(/parent/i);
      expect(content).toMatch(/search-pages/);
    });
    it("resolves a space (spaceKey or derives it from the lifecycle parent)", () => {
      expect(content).toMatch(/spaceKey/);
      expect(content).toMatch(
        /derive.{0,40}space|space could not be established/i
      );
    });
    it("uses GET-then-PUT with a bumped version on update", () => {
      expect(content).toMatch(/GET-then-PUT/);
      expect(content).toMatch(/version\.number/);
    });
  });
});

describe("notion-access gains a create-page operation", () => {
  describe.each(ROOTS)("%s", root => {
    const content = readSkill(root, "notion-access");
    it("documents create-page (POST /v1/pages) in the dispatch table", () => {
      expect(content).toContain("create-page");
      expect(content).toMatch(/POST \/v1\/pages/);
    });
  });
});

describe("research creates the PRD in the source", () => {
  describe.each(ROOTS)("%s", root => {
    const content = readSkill(root, "research");

    it("creates the PRD via prd-source-write rather than emitting a document", () => {
      expect(content).toContain(SHIM);
      expect(content).toMatch(/no (loose|separate) document/i);
    });

    it("honors prd_ready (draft default, ready opt-in)", () => {
      expect(content).toContain("prd_ready");
      expect(content).toMatch(/draft/);
      expect(content).toMatch(/ready/);
    });
  });
});

describe("intent-routing Research flow writes the PRD to the source", () => {
  const content = readFileSync(
    path.resolve("plugins/src/base/rules/intent-routing.md"),
    "utf8"
  );
  it("adds a create-the-PRD-in-the-source step invoking prd-source-write", () => {
    expect(content).toContain(SHIM);
    expect(content).toMatch(/Create the PRD in the configured source/i);
  });
});

describe("project-ideation is persona-driven and chains into research", () => {
  describe.each(ROOTS)("%s", root => {
    const content = readSkill(root, "project-ideation");

    it("derives personas from evidence with a no-fabrication rule", () => {
      expect(content).toMatch(
        /Derive the personas|Personas Derived From Evidence/
      );
      expect(content).toMatch(/no evidence citation.{0,6}no persona/i);
      expect(content).toMatch(/banned unless/i);
    });

    it("ideates per persona", () => {
      expect(content).toMatch(/per persona/i);
      // Phrase can wrap across lines in the prose; tolerate whitespace.
      expect(content).toMatch(/tag each idea\s+with the persona/i);
    });

    it("chains selected ideas into research with prd_ready", () => {
      expect(content).toContain("lisa:research");
      expect(content).toContain("prd_ready");
    });

    it("threads structured ideation ledger metadata into research", () => {
      expect(content).toContain("ideation_ledger_payload");
      for (const field of [
        "selected marker",
        "automation id",
        "memory path",
        "persona names",
        "persona evidence references",
        "rejected overlap",
        "repo identity",
        "expected empirical",
      ]) {
        expect(content).toMatch(new RegExp(field, "i"));
      }
    });

    it("defaults to creating one PRD via max_prds", () => {
      expect(content).toContain("max_prds");
      expect(content).toMatch(
        /default.{0,40}\bone\b|one PRD by default|top-ranked/i
      );
    });

    it("dedupes created PRDs by a stable ideation marker", () => {
      expect(content).toContain(IDEATION_MARKER);
      expect(content).toMatch(/never.*title|matching by marker/i);
    });

    it("no longer writes a report file", () => {
      expect(content).toMatch(/no report file/i);
    });

    it("delegates PRD writing to research, never the source directly", () => {
      expect(content).toMatch(
        /never write.*PRD.*directly|do not write PRDs to the source directly/i
      );
    });
  });
});

describe("research forwards ideation ledger metadata to prd-source-write", () => {
  describe.each(ROOTS)("%s", root => {
    const content = readSkill(root, "research");

    it("accepts and preserves ideation_ledger_payload", () => {
      expect(content).toContain("ideation_ledger_payload");
      expect(content).toMatch(/pass.*through.*unchanged|forward unchanged/i);
      expect(content).toContain("lisa:prd-source-write");
    });
  });
});
