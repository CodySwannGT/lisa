/**
 * Regression tests for doctor verification of optional GitHub ProjectV2
 * coordination.
 *
 * Issue #753 (Story #746, PRD #741): `/lisa:doctor` must route GitHub Project
 * readiness through the shared `github-project-v2` resolve-project chokepoint,
 * preserve exact namespace/access failures, and map the same failure into WARN
 * vs FAIL based on `github.projects.v2.required`.
 *
 * Both plugin roots are asserted so a missed `bun run build:plugins` fails the
 * suite.
 * @module tests/unit/strategies/doctor-project-readiness
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

const readSkill = (root: string): string =>
  readFileSync(path.resolve(root, "doctor", "SKILL.md"), "utf8");

describe.each(ROOTS)("doctor Project readiness contract (%s)", root => {
  const content = readSkill(root);

  it("routes GitHub Project checks through resolve-project", () => {
    expect(content).toMatch(/Minimum GitHub Project coordination checks/i);
    expect(content).toMatch(/operation:\s*resolve-project/i);
    expect(content).toMatch(/Do not inline ad-hoc Project GraphQL in doctor/i);
    expect(content).toMatch(/same owner\/access contract/i);
  });

  it("documents exact namespace-mismatch failure text and remediation", () => {
    expect(content).toMatch(/code:\s*project_namespace_mismatch/i);
    expect(content).toMatch(
      /message:\s*"github\.projects\.v2\.owner\.slug must match github\.org in v1"/i
    );
    expect(content).toMatch(/Use a Project owned by <github\.org>/i);
  });

  it("preserves exact owner-access failures with explicit remediation branches", () => {
    expect(content).toMatch(/exact GitHub \/ GraphQL failure text/i);
    expect(content).toMatch(/Resource not accessible by integration/i);
    expect(content).toMatch(/grant the token Project read\/write access/i);
    expect(content).toMatch(/correct the configured Project number\/owner/i);
  });

  it("maps required=false to WARN and required=true to FAIL", () => {
    expect(content).toMatch(/required:\s*false.*doctor `WARN`/i);
    expect(content).toMatch(/required:\s*true.*doctor `FAIL`/i);
    expect(content).toMatch(
      /Repository-local GitHub issue\/PR flows remain usable/i
    );
  });
});
