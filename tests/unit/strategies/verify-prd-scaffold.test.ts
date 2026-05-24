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
 * This suite asserts the scaffold + PASS-path (#598) + FAIL-path (#599)
 * guarantees the skill documents. The executable proof that the guard's
 * selection + verdict logic is derivable from the consumed `prd-lifecycle-rollup`
 * contract lives in the sibling `verify-prd-guard-logic.test.ts` (split out to
 * keep both files within the max-lines budget).
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

    describe(SKILL_REL, () => {
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
        // Does NOT run empirical verification (tolerate markdown emphasis on "not").
        expect(skill).toMatch(
          /do(es)?\s+\**not\**\s+run empirical verification/i
        );
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

describe("verify-prd PASS path (#598)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    describe(SKILL_REL, () => {
      const skill = read(root, SKILL_REL);

      // (1) Phase 4: invoke spec-conformance with the PRD as the spec source,
      //     never reimplementing the coverage matrix.
      it("invokes spec-conformance with the PRD as spec source without reimplementing the matrix", () => {
        expect(skill).toMatch(/spec-conformance/);
        // The PRD itself is the spec source (not a plan file or leaf ticket).
        expect(skill).toMatch(/PRD as (the )?spec source/i);
        // A section-by-section coverage matrix is produced by that skill.
        expect(skill).toMatch(/coverage matrix/i);
        // Explicitly forbids reimplementing the matrix.
        expect(skill).toMatch(/(do|does) not reimplement[^]*matrix/i);
        // The verdict vocabulary it consumes.
        expect(skill).toContain("CONFORMS");
        expect(skill).toMatch(/PARTIAL/);
        expect(skill).toMatch(/DIVERGES/);
      });

      // (2) Phase 5: empirical verification of the PRD-dependent surface via the
      //     verification-lifecycle skill; quality gates are NOT verification.
      it("runs empirical verification of the PRD-dependent surface via verification-lifecycle", () => {
        expect(skill).toMatch(/verification-lifecycle/);
        // The surface is PRD-dependent, spanning the empirical surfaces.
        expect(skill).toMatch(/surface is PRD-dependent/i);
        expect(skill).toMatch(/browser/i);
        expect(skill).toMatch(/\bAPI\b/);
        expect(skill).toMatch(/\bCLI\b/);
        // Quality gates (test/typecheck/lint) are explicitly NOT verification.
        expect(skill).toMatch(/quality gates[^]*not[^]*verification/i);
        // Each passing empirical check is codified as a regression test.
        expect(skill).toMatch(/codify-verification/);
      });

      // (3) Phase 6 PASS: shipped → verified transition + evidence, only on
      //     CONFORMS + all empirical passing.
      it("transitions shipped → verified and posts evidence on a passing result", () => {
        expect(skill).toMatch(/shipped → verified/);
        // Gated on BOTH conformance CONFORMS and empirical passing.
        expect(skill).toMatch(/CONFORMS[^]*empirical|empirical[^]*CONFORMS/i);
        // Posts verification evidence back on the PRD.
        expect(skill).toMatch(/evidence/i);
        expect(skill).toMatch(/tracker-evidence/);
        // Vendor-neutral verified role vocabulary (config-resolution).
        expect(skill).toContain("prd-verified");
        expect(skill).toMatch(/config-resolution/);
        expect(skill).toMatch(/confluence\.parents\.verified/);
      });

      // (4) The PASS verdict tokens are declared. The non-pass verdicts now
      //     route to the FAIL path (#599) rather than being left at shipped;
      //     only idempotency (#600) remains out of scope.
      it("declares the PASS verdict tokens alongside the non-pass verdicts", () => {
        expect(skill).toContain("VERIFIED_PASS");
        expect(skill).toContain("CONFORMANCE_FAILED");
        expect(skill).toContain("EMPIRICAL_FAILED");
        // The guard/no-children branches still leave the PRD at shipped.
        expect(skill).toMatch(
          /left? (the PRD )?at .?shipped.?|stays at .?shipped.?/i
        );
        // Idempotency (#600) is the only phase still out of scope.
        expect(skill).toMatch(/out of scope/i);
        expect(skill).toMatch(/idempoten/i);
      });

      // (5) Cites prd-lifecycle-rollup for the PASS hop; verified is product-owned.
      it("cites prd-lifecycle-rollup for the shipped → verified hop", () => {
        expect(skill).toContain(RULE_SLUG);
        expect(skill).toMatch(/shipped → verified/);
        // verified is product-owned and this skill is its only automated writer.
        expect(skill).toMatch(/verified.{0,40}product-owned/i);
      });
    });
  });
});

describe("verify-prd FAIL path (#599)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    describe(SKILL_REL, () => {
      const skill = read(root, SKILL_REL);

      // AC scenario "fail transitions shipped to blocked": the FAIL path moves
      // the PRD shipped → blocked, REUSING the existing blocked role (no new
      // failure state), gated on the non-pass verdicts.
      it("transitions shipped → blocked reusing the blocked role with no new failure state", () => {
        expect(skill).toMatch(/shipped → blocked/);
        // Triggered by either non-pass verdict cause.
        expect(skill).toContain("CONFORMANCE_FAILED");
        expect(skill).toContain("EMPIRICAL_FAILED");
        // Reuses the existing blocked role — explicitly NO new failure state.
        expect(skill).toMatch(/reus(e|ing|es)[^]*blocked role/i);
        expect(skill).toMatch(/no new failure state/i);
        // Does not invent a prd-verification-failed / prd-verifying state.
        expect(skill).toMatch(
          /no(t)?[^]*prd-verification-failed|prd-verification-failed[^]*prd-verifying/i
        );
        // Vendor-neutral blocked role vocabulary (config-resolution).
        expect(skill).toContain("prd-blocked");
        expect(skill).toMatch(/config-resolution/);
        expect(skill).toMatch(/confluence\.parents\.blocked/);
      });

      // AC scenario "failure report is posted": a product-readable report naming
      // which requirements/ACs failed with observed-vs-expected evidence.
      it("posts a product-readable failure report with observed-vs-expected evidence", () => {
        expect(skill).toMatch(/failure report/i);
        // Written for a non-engineer product owner, in plain language.
        expect(skill).toMatch(/product-readable|non-engineer/i);
        expect(skill).toMatch(/plain language/i);
        // Names the specific failed requirement / acceptance criterion.
        expect(skill).toMatch(
          /requirement[^]*acceptance criterion|acceptance criteri/i
        );
        // Observed vs expected evidence is included.
        expect(skill).toMatch(
          /expected vs[^]*observed|observed vs[^]*expected/i
        );
        // Posted via the vendor-neutral evidence surface (tracker-evidence).
        expect(skill).toMatch(/tracker-evidence/);
      });

      // AC scenario "linked fix issues are created": one or more fix issues via
      // tracker-write, each back-linked to the PRD + failure report, each with
      // captured evidence and acceptance criteria.
      it("creates linked fix issues via tracker-write with evidence, ACs, and back-links", () => {
        expect(skill).toMatch(/fix issue/i);
        // Created via the vendor-neutral writer (so they pass tracker-validate).
        expect(skill).toMatch(/tracker-write/);
        // Each carries Gherkin acceptance criteria.
        expect(skill).toMatch(/[Gg]herkin/);
        expect(skill).toMatch(/acceptance criteria/i);
        // Each back-links to BOTH the PRD and the failure report.
        expect(skill).toMatch(/back-link[^]*PRD|PRD[^]*failure report/i);
        // Each references the specific failed requirement / AC and carries evidence.
        expect(skill).toMatch(
          /specific failed requirement|failed requirement\/AC/i
        );
        expect(skill).toMatch(
          /carry the captured evidence|carrying the captured evidence/i
        );
      });

      // The FAIL path is implemented HERE — it must NOT be deferred to a sibling.
      // Only idempotency (#600) remains out of scope.
      it("implements the FAIL path here and scopes only idempotency to a sibling", () => {
        // FAIL path is in scope (Phase 7 exists with the shipped → blocked hop).
        expect(skill).toMatch(/Phase 7[^]*FAIL/i);
        // Idempotency (#600) is the remaining sibling work / out of scope.
        expect(skill).toMatch(/idempotency \(#600\)|idempoten[^]*sibling/i);
        // Fix issues are NOT reopens of the already-terminal generated children.
        expect(skill).toMatch(/never[^]*reopen|not[^]*reopen/i);
        expect(skill).toMatch(/leaf-only-lifecycle/);
      });

      // Cites prd-lifecycle-rollup for the FAIL hop by slug (consumer, not a
      // second source of truth for the shipped → blocked transition).
      it("cites prd-lifecycle-rollup for the shipped → blocked FAIL hop", () => {
        expect(skill).toContain(RULE_SLUG);
        expect(skill).toMatch(/shipped → blocked/);
        // The "no extra failure states" rule the FAIL hop honors.
        expect(skill).toMatch(/no extra failure states|no new failure state/i);
      });
    });
  });
});
