/**
 * Regression coverage for the repair-intake operator contract.
 *
 * The skill is the executable contract for cron repair behavior, so these tests
 * guard the high-risk semantics that should not drift back to single-item
 * pickup or miss terminal close-out repairs.
 * @module tests/unit/strategies/repair-intake-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, relative: string): string =>
  readFileSync(path.resolve(root, relative), "utf8");

describe("repair-intake contract", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = read(root, "skills/repair-intake/SKILL.md");
    const command = read(root, "commands/repair-intake.md");

    it("repairs every actionable candidate inside max_candidates", () => {
      expect(skill).toMatch(/Repair every materially actionable candidate/i);
      expect(skill).toMatch(/default cap is 100/i);
      expect(command).toMatch(/repair every materially actionable candidate/i);
      expect(`${skill}\n${command}`).not.toMatch(
        /one materially actionable repair|first materially actionable one|One actionable repair/
      );
    });

    it("defaults dual GitHub repair queues to both lifecycles", () => {
      expect(skill).toMatch(/Absent .*`both` when both namespaces exist/is);
      expect(skill).toMatch(/Default GitHub `intake_mode` is `both`/);
      expect(command).toMatch(/default GitHub intake_mode is both/i);
    });

    it("includes terminal native closure and completed rollup repair paths", () => {
      expect(skill).toMatch(/Build terminal-open.*native close/is);
      expect(skill).toMatch(/PRD terminal-open.*close \/ archive/is);
      expect(skill).toMatch(/Build parent rollup reconciliation/is);
      expect(skill).toMatch(/PRD rollup with all generated work terminal/is);
      expect(command).toMatch(/terminal native closure/i);
      expect(command).toMatch(/completed rollups/i);
    });

    it("reconciles intermediate-env parent rollups, not only terminal close-out", () => {
      const section = skill.slice(
        skill.indexOf("### Build parent rollup reconciliation")
      );
      // Generalized beyond fully-terminal: handles intermediate envs too.
      expect(section).toMatch(/intermediate-env/i);
      expect(section).toMatch(/least-advanced/i);
      // Native closure stays gated on the true production terminal.
      expect(section).toMatch(
        /native closure only at the true terminal|only.*production/i
      );
      // The cron sweep documents the SE-318 case (e.g. all children at On Stg).
      expect(skill).toMatch(/On Stg/);
    });

    it("reconciles a container wrongly stuck in `ready`, never a ready leaf", () => {
      // Narrowed guard: ready LEAVES are intake's lane; a ready CONTAINER is reconciled.
      expect(skill).toMatch(/Touch `ready` \*\*leaves\*\*/);
      expect(skill).toMatch(/[Ss]tale-`ready` container/);
      expect(skill).toMatch(/invariant violation/i);
      // It is the one documented ready-touching exception.
      expect(skill).toMatch(/one .*exception|the one exception/i);
    });

    it("normalizes GitHub issues missing official lifecycle labels into ready", () => {
      expect(skill).toMatch(/Missing official ready-label drift/);
      expect(skill).toMatch(/no configured Lisa lifecycle label/);
      expect(skill).toMatch(
        /GitHub missing official ready-label normalization/
      );
      expect(skill).toMatch(/default to \*\*Build ticket\*\*/);
      expect(skill).toMatch(/configured PRD\/build `ready` label/);
      expect(skill).toMatch(/normalized_ready/);
      expect(skill).toMatch(/Official lifecycle labels remain authoritative/);
    });

    it("repairs GitHub PRDs missing native top-level child links", () => {
      expect(skill).toMatch(/Missing native child link drift/);
      expect(skill).toMatch(/GitHub PRD missing child links/);
      expect(skill).toMatch(/Top-level work:/);
      expect(skill).toMatch(/lisa:gw/);
      expect(skill).toMatch(/subIssues/);
      expect(skill).toMatch(/addSubIssue/);
      expect(skill).toMatch(
        /Leaf Sub-tasks and descendant Stories are never direct PRD children/
      );
      expect(skill).toMatch(/relinked/);
      expect(command).toMatch(/missing native child links/);
    });

    it("recovers a merged-PR leaf staleness-exempt, before rollup, with merged PRs discoverable", () => {
      // Regression: four shipped Sub-tasks (#1171-1174) stayed status:in-progress
      // for a day because the merged-PR leaf recovery was (a) gated behind the
      // staleness clock — which a merged PR's post-merge CI/CodeRabbit activity
      // kept warm — and (b) ordered last (generic stalled bucket), after the
      // rollup buckets, so parents reconciled against not-yet-closed children.

      // (a) A merged-PR leaf is explicitly NOT gated on staleness.
      expect(skill).toMatch(
        /already merged[\s\S]*?(is likewise )?NOT[\s\S]*?gated on staleness/i
      );
      // Post-merge activity must not defer recovery (the keep-alive trap).
      expect(skill).toMatch(/post-merge activity does not defer it/i);
      // The merged check happens before the staleness gate in the decision tree.
      expect(skill).toMatch(/this check is NOT gated on staleness/i);

      // (b) Dedicated high-confidence ordering bucket that runs before rollup.
      expect(skill).toMatch(
        /build `claimed` leaves whose linked PR is \*\*already merged\*\*/
      );
      expect(skill).toMatch(/MUST run before any rollup\s+bucket/);
      // The generic stalled bucket is scoped to PRs that have NOT merged.
      expect(skill).toMatch(
        /\*\*stalled\*\* in-progress items \(PR not merged\)/
      );

      // (c) Discovery includes merged (closed) PRs — search defaults to open.
      expect(skill).toMatch(/gh pr list --search <issue-ref> --state all/);
      expect(skill).toMatch(/closedByPullRequestsReferences/);
      expect(skill).toMatch(/defaults to `--state open`/);
    });

    it("does not let automation self-comments reset the stalled claimed clock", () => {
      expect(skill).toMatch(
        /last state-changing transition into the in-progress role/i
      );
      expect(skill).toMatch(/automation self-comments/i);
      expect(skill).toMatch(/must not reset the staleness clock/i);
      expect(skill).toMatch(/\[claude-build-intake\]/);
      expect(skill).toMatch(/\[codex-build-intake\]/);
    });

    it("heals missing native sub-issue links on build Epic/Story containers", () => {
      // The native-link repair is no longer PRD-only: build containers whose
      // children were recorded as prose parentage (e.g. created by an external
      // generator that never called addSubIssue) must be attached too, so the
      // GitHub UI rollup is not left empty.
      const section = skill.slice(
        skill.indexOf("### Build parent rollup reconciliation"),
        skill.indexOf("### PRD `in_review`")
      );
      // The rollup path attaches missing native links before computing status.
      expect(section).toMatch(/addSubIssue/);
      expect(section).toMatch(/body-parentage|Parent Epic/i);
      // It runs even when the derived status is unchanged, since the native
      // graph is independent of the parent's lifecycle label.
      expect(section).toMatch(/even when step 2 derives `unchanged`/i);
      // The candidate type and "It MAY" guard are generalized to build parents.
      expect(skill).toMatch(/build Epic\/Story container/);
    });
  });
});
