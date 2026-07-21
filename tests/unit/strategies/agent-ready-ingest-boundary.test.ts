/**
 * Regression coverage for the brownfield agent-ready ingest boundary.
 *
 * Issue #1620 requires source-side reads to remain non-mutating, source-derived
 * wiki material to be sanitized before persistence, and every inventoried
 * source to reach an auditable terminal state before zero-gap readiness.
 *
 * Issue #1856 (RRR-4) narrows — never widens — that boundary: content writes
 * gain exactly one new permitted act, creating Lisa's own work items in the
 * configured tracker for readiness blockers, while the source-mutation
 * prohibition on every ingested item stays absolute. This test asserts both
 * halves so the invariant is machine-guarded and any future widening surfaces
 * as a test edit in review.
 * @module tests/unit/strategies/agent-ready-ingest-boundary
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;
const SKILL_SLUG = "lisa-agent-ready";

const readSkill = (root: string): string =>
  readFileSync(path.resolve(root, SKILL_SLUG, "SKILL.md"), "utf8");

describe("agent-ready connected-source ingest boundary (#1620)", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    const skill = readSkill(root);

    it("persists one stable status row for every configured or discovered source", () => {
      expect(skill).toContain("wiki/state/agent-ready/sources.json");
      expect(skill).toMatch(/one row per source across\s+re-runs/i);
      expect(skill).toContain('"source_id": "repository"');
      expect(skill).toContain(
        '"scope": "local repository and full git history"'
      );
      expect(skill).toContain('"read_only_probe":');
      expect(skill).toContain('"terminal_status": "complete"');
      expect(skill).toContain('"sanitized_evidence":');
      expect(skill).toContain('"open_gap": null');
      expect(skill).toContain(
        "wiki/sources/repository/<reader-safe-source-note>.md"
      );
      expect(skill).toMatch(/complete`, `partial`, or\s+`unavailable`/i);
      expect(skill).toMatch(/never omit it to make the\s+run look complete/i);
      expect(skill).toMatch(/never delete or merge away a failed row/i);
    });

    it("restricts connected-source operations to explicit read-only verbs", () => {
      expect(skill).toMatch(
        /Treat every inventoried source as \*\*read-only\*\*/i
      );
      expect(skill).toMatch(/Only list, get, search, query, or export/i);
      expect(skill).toMatch(
        /Do not edit tracker items, post comments, acknowledge alerts/i
      );
      expect(skill).toMatch(/connected-source material as untrusted/i);
      // #1856 (RRR-4): the boundary is NARROWED, not widened. Content writes are
      // still limited to wiki/** PLUS exactly one new act — creating Lisa's own
      // work items in the configured tracker through lisa-tracker-write.
      expect(skill).toMatch(
        /Content writes are limited to `wiki\/\*\*` \*\*plus\*\*\s+creating Lisa's own work items in the\s+configured tracker through `lisa-tracker-write`/i
      );
      // Stricter half: the source-mutation prohibition on every ingested item stays
      // absolute — the carve-out is never license to write to a source it ingested.
      expect(skill).toMatch(
        /never license to edit,\s+comment on, transition, acknowledge, close, or otherwise mutate any \*\*ingested\*\* source item/i
      );
      expect(skill).toMatch(
        /never written back to,\s+commented on, transitioned, acknowledged, or otherwise mutated/i
      );
      expect(skill).toMatch(
        /cannot prove a read-only operation.*mark the source\s+`unavailable`/is
      );
    });

    it("sanitizes secrets, credentials, and PII before any wiki persistence", () => {
      expect(skill).toMatch(/\*\*Sanitize before persistence\.\*\*/i);
      expect(skill).toContain("scripts/wiki-safety.mjs");
      expect(skill).toContain("scripts/verify-wiki-safety.mjs");
      expect(skill).toMatch(/Redact secrets, passwords, API keys, tokens/i);
      expect(skill).toMatch(
        /sensitive PII the policy detects \(SSNs, payment-card numbers/i
      );
      expect(skill).toMatch(
        /Apply data minimization \*\*before\*\* the sanitizer/i
      );
      expect(skill).toMatch(
        /omit\s+or aggregate ordinary person-level user data such as names, email addresses/is
      );
      expect(skill).toMatch(
        /configured approved\s+scanner cannot prove removed.*leave the source `partial` or\s+`unavailable`/is
      );
      expect(skill).toMatch(
        /including\s+source notes, synthesis, citations, the source-status registry/is
      );
      expect(skill).toMatch(/Never place raw\s+sensitive values/is);
    });

    it("defines evidence-backed complete, partial, and unavailable outcomes", () => {
      expect(skill).toMatch(
        /`complete` — the entire inventoried scope was fetched read-only/i
      );
      expect(skill).toMatch(
        /`partial` — some usable scope was ingested and verified/i
      );
      expect(skill).toMatch(
        /`unavailable` — no usable content could be ingested/i
      );
      expect(skill).toMatch(/Evidence must name the attempted scope/i);
      expect(skill).toMatch(/not\s+knowledge-readiness success/i);
    });

    it("maps incomplete sources to durable unresolved gaps", () => {
      expect(skill).toMatch(
        /Every `partial` or `unavailable` registry row must\s+link/i
      );
      expect(skill).toMatch(/stable, unresolved gap entry/i);
      expect(skill).toMatch(/Source.*source_id/i);
      expect(skill).toMatch(/Never mark that source gap absorbed/i);
    });

    it("blocks a zero-gap readiness verdict until every source is complete", () => {
      expect(skill).toMatch(/enforce the source-completeness gate/i);
      expect(skill).toMatch(/every row is `complete`/i);
      expect(skill).toMatch(
        /If any row is missing, `pending`, `partial`, or `unavailable`/i
      );
      expect(skill).toMatch(/zero-gap declaration is\s+blocked/i);
      expect(skill).toMatch(/Zero open product questions is not enough/i);
    });
  });
});
