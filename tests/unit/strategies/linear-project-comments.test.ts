/**
 * Regression coverage for Linear **project-level** comments.
 *
 * `lisa-linear-access` is the mandated gateway for Linear, and it exposed only
 * issue-anchored comment operations. `lisa-linear-prd-intake` worked around
 * that absence by find-or-creating one permanent, never-closable "sentinel"
 * Issue per PRD project to hold the comments that anchor to no sub-issue — a
 * workaround that leaves durable litter and, because the sentinel can never be
 * terminal, held its own project out of the shipped rollup forever.
 *
 * The premise was wrong about the substrate, not just the wrapper: Linear's
 * `CommentCreateInput` accepts `projectId`, and `Project.comments` reads them
 * back. These assertions pin the project forms onto the access layer's
 * documented contract, and pin the two behaviors that depend on them — intake
 * posting unanchored feedback on the project, and the rollup excluding legacy
 * sentinels from its denominator.
 * @module tests/unit/strategies/linear-project-comments
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Plugin source and its generated fan-out must agree. */
const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The mutation input field that makes a project comment possible. */
const PROJECT_ID_FIELD = "projectId";

/** The access-layer argument callers pass to anchor a comment on a project. */
const PROJECT_ID_ARG = "project_id";

/** The label naming the fabricated feedback issues earlier versions created. */
const SENTINEL_ROLE = "SENTINEL";

/**
 * Collapse every whitespace run to one space so an assertion can quote prose
 * that the markdown happens to wrap. Matching across a line break with a regex
 * would need a backtracking-prone quantifier; normalizing the haystack once is
 * linear and lets the assertions stay literal substrings.
 * @param text - The file content to normalize.
 * @returns The same text with all whitespace runs collapsed to single spaces.
 */
const squash = (text: string): string => text.split(/\s+/u).join(" ");

const read = (root: string, relative: string): string =>
  readFileSync(path.resolve(root, relative), "utf8");

const accessSkill = (root: string): string =>
  read(root, "skills/lisa-linear-access/SKILL.md");

const intakeSkill = (root: string): string =>
  read(root, "skills/lisa-linear-prd-intake/SKILL.md");

const intakeAgent = (root: string): string =>
  read(root, "agents/linear-prd-intake.md");

describe("linear project comments", () => {
  describe.each(ROOTS)("%s", root => {
    describe("access layer", () => {
      const skill = accessSkill(root);

      it("documents the project form of both comment operations", () => {
        expect(skill).toContain(
          `operation: list-comments (issue_id:<ID> | ${PROJECT_ID_ARG}:<ID>)`
        );
        expect(skill).toContain(
          `operation: save-comment (issue_id:<ID> | ${PROJECT_ID_ARG}:<ID>) body:"..."`
        );
      });

      it("maps the project form onto commentCreate and Project.comments", () => {
        expect(skill).toContain("commentCreate(input:$input)");
        expect(skill).toContain(`{ ${PROJECT_ID_FIELD}: <id>, body: <body> }`);
        expect(squash(skill)).toContain("project(id:$id){ comments(first:100)");
      });

      it("cites the introspected input fields rather than documentation", () => {
        expect(skill).toContain("CommentCreateInput");
        expect(skill).toContain("Project.comments");
      });

      it("requires exactly one anchor and forbids fabricating a holder", () => {
        // Both-or-neither is refused, and the layer never invents an Issue to
        // carry a Project's comment — that invention is the defect being fixed.
        expect(skill).toMatch(/never both and never neither/i);
        expect(squash(skill)).toContain(
          "never creates an Issue to hold the comment"
        );
        expect(skill).toMatch(/do \*\*not\*\* silently degrade/i);
      });

      it("scopes the project form to the GraphQL substrate", () => {
        // The Linear MCP comments on Issues only, so the project form resolves
        // solely through tier 1 — the same restriction `history` carries.
        const substrate = squash(skill);
        expect(substrate).toContain(
          "Linear MCP exposes comments on Issues only"
        );
        expect(substrate).toContain(
          "`project_id` form resolves solely through the tier-1 `LINEAR_API_KEY` + GraphQL substrate"
        );
      });
    });

    describe("PRD intake", () => {
      const skill = intakeSkill(root);

      it("posts unanchored clarifying comments on the project", () => {
        expect(skill).toContain(
          `save-comment ${PROJECT_ID_ARG}:<id> body:<template>`
        );
        expect(skill).toMatch(
          /batched into one comment on the \*\*project itself\*\*/
        );
      });

      it("no longer find-or-creates a feedback issue", () => {
        // The find-or-create step and its "Ensure the project has a sentinel
        // feedback issue" preamble are both gone.
        expect(skill).not.toMatch(/Ensure the project has a sentinel/i);
        expect(skill).not.toMatch(/find-or-creates\b/i);
        expect(skill).toMatch(/no longer creates a sentinel/i);
      });

      it("forbids creating an issue merely to hold a comment", () => {
        expect(skill).toMatch(/Never create a Linear issue to hold a comment/i);
      });

      it("excludes legacy sentinels from the rollup denominator", () => {
        // Regardless of state — the point is that a project which already has
        // one unjams without anyone touching the sentinel itself.
        expect(skill).toContain(
          `Exclude any Issue carrying the \`$${SENTINEL_ROLE}\` label from the child set entirely`
        );
        expect(skill).toMatch(/excluded regardless of its state/i);
        expect(skill).toMatch(
          /absent from both the numerator and the denominator/i
        );
      });

      it("keeps the sentinel role as a read-only recognizer", () => {
        // Out of scope here: deleting the existing issues. Their comment
        // history is a real audit trail with nowhere else to live yet.
        expect(skill).toMatch(/read-only recognizer/i);
        expect(skill).toMatch(
          /Do not close, archive, delete, or repurpose an existing sentinel/i
        );
      });
    });

    describe("PRD intake agent", () => {
      const agent = intakeAgent(root);

      it("retracts the claim that Linear cannot take project comments", () => {
        expect(agent).not.toMatch(
          /because Linear's MCP doesn't expose project-level comments/i
        );
        expect(agent).toMatch(/That premise was wrong about the substrate/i);
        expect(agent).toContain(
          `commentCreate(input: { ${PROJECT_ID_FIELD}, body })`
        );
      });

      it("forbids fabricating an issue to hold a comment", () => {
        expect(agent).toMatch(/Never fabricate an issue to hold a comment/i);
      });
    });
  });
});
