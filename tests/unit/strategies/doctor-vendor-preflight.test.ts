/**
 * Regression tests for the doctor tracker/source preflight contract.
 *
 * Issue #752 (Story #746, PRD #741): `/lisa:doctor` must describe how it
 * proves tracker/source readiness without mutating state. The contract needs to
 * stay explicit about which vendors are checked, which read-only substrates
 * count, and how missing tooling differs from missing auth or scope.
 *
 * Both plugin roots and both rules roots are asserted so source-only or
 * artifact-only edits fail fast.
 * @module tests/unit/strategies/doctor-vendor-preflight
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

describe.each(SKILL_ROOTS)("doctor vendor preflight contract (%s)", root => {
  const content = readDoctorSkill(root);

  it("checks only the configured tracker and source vendors", () => {
    expect(content).toContain("### Minimum tracker/source preflight checks");
    expect(content).toMatch(/configured vendors only/i);
    expect(content).toMatch(/Audit the merged `tracker`/);
    expect(content).toMatch(
      /merged `source` only when present and distinct from the tracker/i
    );
    expect(content).toMatch(/non-configured vendors? as `SKIP`/i);
  });

  it("documents the vendor-specific read-only substrates", () => {
    expect(content).toMatch(/`tracker=github`.*`source=github`/s);
    expect(content).toMatch(/`gh` CLI availability/i);
    expect(content).toMatch(/gh auth status/i);
    expect(content).toMatch(/gh repo view <org>\/<repo>/i);
    expect(content).toMatch(
      /`tracker=jira`, `source=jira`, or `source=confluence`/
    );
    expect(content).toMatch(
      /`acli`, Atlassian MCP, or the\s+validated API-token\/curl path/i
    );
    expect(content).toMatch(/`tracker=linear` or `source=linear`/);
    expect(content).toMatch(
      /readable Linear MCP access or a valid\s+personal API-key probe/i
    );
    expect(content).toMatch(/`source=notion`/);
    expect(content).toMatch(/Notion MCP identity match/i);
    expect(content).toMatch(/`notion\.prdDatabaseId`/i);
  });

  it("separates missing tooling from auth or scope failures and defines severity", () => {
    expect(content).toMatch(
      /Missing executable \/ MCP substrate availability is a distinct observed fact/i
    );
    expect(content).toMatch(
      /exact read-only failure text or HTTP\/GraphQL status/i
    );
    expect(content).toMatch(
      /`PASS` when at least one supported read-only substrate proves/i
    );
    expect(content).toMatch(
      /`WARN` when the configured vendor is reachable, but an additional optional substrate is\s+unavailable/i
    );
    expect(content).toMatch(
      /`FAIL` when no supported substrate can prove read access/i
    );
  });
});

describe.each(RULE_ROOTS)(
  "config-resolution doctor vendor preflight docs (%s)",
  rulesRoot => {
    const content = readFileSync(
      path.resolve(rulesRoot, "config-resolution.md"),
      "utf8"
    );

    it("defines one shared doctor vendor-preflight section", () => {
      expect(content).toContain("### Doctor vendor preflight");
      expect(content).toMatch(/read-only vendor\s+preflight/i);
      expect(content).toMatch(/configured vendors only/i);
      expect(content).toMatch(/Every other vendor is a doctor `SKIP`/i);
    });

    it("documents the vendor substrate ladder expectations", () => {
      expect(content).toMatch(
        /`github` requires `gh` CLI, a passing `gh auth status`/i
      );
      expect(content).toMatch(
        /`jira` \/ `confluence` must reuse the `atlassian-access` substrate ladder/i
      );
      expect(content).toMatch(
        /`acli`, Atlassian MCP, or\s+validated curl\/API\s+token/i
      );
      expect(content).toMatch(
        /`linear` passes when either the Linear MCP or a validated\s+API-key probe/i
      );
      expect(content).toMatch(
        /`notion` passes when either the Notion MCP identity matches\s+`notion\.workspaceId`/i
      );
    });

    it("documents exact-failure preservation and WARN vs FAIL branching", () => {
      expect(content).toMatch(
        /Preserve the exact probe failure text or status code/i
      );
      expect(content).toMatch(
        /No read-capable substrate for the configured vendor.*doctor `FAIL`/s
      );
      expect(content).toMatch(
        /reachable vendor with only auxiliary-substrate degradation is a doctor `WARN`/i
      );
    });
  }
);
