/**
 * Regression tests for the doctor config-readiness contract.
 *
 * Issue #751 (Story #746, PRD #741): `/lisa:doctor` needs an explicit config
 * audit contract before later runtime probes implement it. The skill must
 * describe parse failures, merged effective-config semantics, vendor required
 * keys, and local-vs-committed warnings using the same `config-resolution`
 * rules every writer/intake flow already follows.
 *
 * Both plugin roots and both rules roots are asserted so source-only or
 * artifact-only edits fail fast.
 * @module tests/unit/strategies/doctor-config-readiness
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;
const RULE_ROOTS = [
  "plugins/src/base/rules/reference",
  "plugins/lisa/rules/reference",
] as const;

const readDoctorSkill = (root: string): string =>
  readFileSync(path.resolve(root, "lisa-doctor", "SKILL.md"), "utf8");

describe.each(SKILL_ROOTS)("doctor config-readiness contract (%s)", root => {
  const content = readDoctorSkill(root);

  it("requires parseable committed and local config files", () => {
    expect(content).toContain("Presence + parseability");
    expect(content).toMatch(
      /\.lisa\.config\.json` is missing, empty, or invalid JSON/i
    );
    expect(content).toMatch(/\.lisa\.config\.local\.json.*invalid JSON/i);
  });

  it("documents merged effective-config semantics and required dispatch keys", () => {
    expect(content).toMatch(/per-key local-overrides-global semantics/i);
    expect(content).toMatch(/effective merged value/i);
    expect(content).toMatch(/merged `tracker` is missing/i);
    expect(content).toMatch(/merged `source` is present but is not one of/i);
  });

  it("documents vendor required-key failures and locality warnings", () => {
    expect(content).toMatch(/Vendor required-key audit/i);
    expect(content).toMatch(/tracker=github.*github\.org.*github\.repo/s);
    expect(content).toMatch(
      /source=notion.*notion\.workspaceId.*notion\.prdDatabaseId/s
    );
    expect(content).toMatch(/Local-vs-committed locality audit/i);
    expect(content).toMatch(
      /atlassian\.email.*intake\.assignee.*jira\.verified_workflow_hash/s
    );
    expect(content).toMatch(
      /project-wide shared fields exist only in `\.lisa\.config\.local\.json`/i
    );
  });
});

describe.each(RULE_ROOTS)(
  "config-resolution doctor readiness docs (%s)",
  rulesRoot => {
    const content = readFileSync(
      path.resolve(rulesRoot, "config-resolution.md"),
      "utf8"
    );

    it("defines doctor's config-readiness audit in one shared section", () => {
      expect(content).toContain("### Doctor config readiness");
      expect(content).toMatch(/Doctor must validate config in three layers/i);
      expect(content).toMatch(/parse both config files as JSON/i);
      expect(content).toMatch(/merged[\s\S]*effective config/i);
    });

    it("documents required-key failures and local-only fields", () => {
      expect(content).toMatch(
        /Missing `tracker` after merge is a blocking error/i
      );
      expect(content).toMatch(
        /configured tracker\/source vendor is missing its required keys/i
      );
      expect(content).toMatch(
        /`atlassian\.email`, `intake\.assignee`, and `jira\.verified_workflow_hash` are local-only/i
      );
    });

    it("documents shared-field-in-local warnings for doctor", () => {
      expect(content).toMatch(
        /project-wide fields that exist only in `\.lisa\.config\.local\.json`/i
      );
      expect(content).toMatch(
        /`github\.org`, `github\.repo`[\s\S]*`atlassian\.cloudId`, `atlassian\.site`[\s\S]*`deploy\.branches`/i
      );
      expect(content).toMatch(
        /Current machine works, repository not durably configured/i
      );
    });
  }
);
