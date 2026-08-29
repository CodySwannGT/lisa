/**
 * Prose contract for the per-work-item Roster Decision path (SE-490).
 *
 * The Roster Decision used to be written to a single `.lisa/roster.md` per
 * repository. Two flows running concurrently in one repository both wrote it,
 * and the first time each created it the merge was ADD/ADD — no common ancestor
 * for git to three-way, so resolution was a coin flip that silently discarded
 * the other flow's roster. Observed between a docs flow and a release-train
 * flow in one downstream repository, where the losing side's roster went and
 * nothing signalled it.
 *
 * The fix is a path, not a merge strategy: one file per work item cannot
 * collide. It matches the per-flow `.lisa/plan-<id>.md` artifacts Lisa already
 * writes into the same directory.
 *
 * What this file can and cannot prove is worth stating plainly. The roster is
 * written by an agent following these instructions, not by a code path, so
 * there is no function to unit-test — the instruction text IS the contract
 * surface, and it is pinned here across the canonical source and every
 * checked-in runtime projection, exactly as the sibling `*-contract` suites do.
 * The one mechanically observable half — that a per-work-item roster stays
 * trackable under the shipped ignore template — is adjudicated by git in
 * `copy-contents-gitignore.test.ts` rather than asserted from rule text here.
 * @module tests/unit/strategies/roster-per-flow-path-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const IMPLEMENT_SKILL_PATHS = [
  "plugins/src/base/skills/lisa-implement/SKILL.md",
  "plugins/lisa/skills/lisa-implement/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-implement/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-implement/SKILL.md",
  "plugins/lisa-agy/skills/lisa-implement/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-implement/SKILL.md",
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

describe.each(IMPLEMENT_SKILL_PATHS)(
  "Roster Decision path is per work item (%s)",
  skillPath => {
    const skill = read(skillPath);

    it("directs the roster to a per-work-item path", () => {
      expect(skill).toContain(".lisa/roster/<work-item-slug>.md");
    });

    it("no longer directs the flow to WRITE the one shared roster file", () => {
      // The defect in one line: every flow in a repository writing the same
      // path. Scoped to the write directive on purpose — the shared filename is
      // still named further down, telling a flow to leave an already-committed
      // legacy roster alone, and a blanket ban on the string would forbid that
      // instruction along with the defect.
      expect(skill).not.toMatch(/write `\$\{[^`]*\}\/\.lisa\/roster\.md`/);
      expect(skill).not.toMatch(/otherwise write[^.]*\.lisa\/roster\.md`/);
    });

    it("defines the slug so two runtimes cannot derive different filenames", () => {
      // An underspecified slug reintroduces the collision from the other side:
      // two flows on the SAME work item writing two different filenames is as
      // wrong as two work items sharing one.
      expect(skill).toContain("[A-Za-z0-9._-]");
      expect(skill).toContain("CodySwannGT-lisa-3395");
    });

    it("says why, so the path is not tidied back into a shared file", () => {
      expect(skill).toMatch(/add\/add/i);
      expect(skill).toMatch(/concurrent/i);
    });

    it("keeps rosters trackable rather than reclassifying them as scratch", () => {
      // #1607 settled that `.lisa/` ignores specific runtime filenames and that
      // the roster is auditable project knowledge. This change moves the path
      // and must not quietly reverse that decision.
      expect(skill).toMatch(/trackable/i);
      expect(skill).toContain("CodySwannGT/lisa#1607");
      expect(skill).toMatch(/Do not add `\.lisa\/roster\/` to `\.gitignore`/);
    });

    it("leaves an already-committed legacy roster alone", () => {
      // Downstream repositories already carry a committed `.lisa/roster.md`.
      // Migrating or deleting it is churn in someone else's history.
      expect(skill).toMatch(/leave it alone|keeps it/i);
    });
  }
);
