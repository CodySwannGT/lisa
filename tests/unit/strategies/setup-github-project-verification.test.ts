/**
 * Regression tests for setup/doctor verification of optional GitHub ProjectV2
 * coordination.
 *
 * Issue #705 extends `setup-github` so setup-time validation does not stop at
 * writing config and labels. When `github.projects.v2` is configured, setup
 * verification must run the shared `github-project-v2` utility in
 * `resolve-project` mode, preserve exact owner/access failures, and branch
 * severity on `required` so operators get an exact remediation path before they
 * rely on Project coordination.
 *
 * Both plugin roots are asserted so a missed `bun run build:plugins` fails the
 * suite.
 * @module tests/unit/strategies/setup-github-project-verification
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

const readSkill = (root: string): string =>
  readFileSync(path.resolve(root, "lisa-setup-github", "SKILL.md"), "utf8");

describe.each(ROOTS)("setup-github Project verification (%s)", root => {
  const content = readSkill(root);

  it("runs shared Project resolution during setup verification", () => {
    expect(content).toMatch(/Step 6 .*Verify/s);
    expect(content).toMatch(/operation:\s*resolve-project/i);
    expect(content).toMatch(/delegate to `lisa-github-project-v2`/i);
  });

  it("documents exact namespace-mismatch failure text and remediation", () => {
    expect(content).toMatch(/code:\s*project_namespace_mismatch/i);
    expect(content).toMatch(
      /message:\s*"github\.projects\.v2\.owner\.slug must match github\.org in v1"/i
    );
    expect(content).toMatch(/Use a Project owned by <github\.org>/i);
  });

  it("requires exact owner-access failures and remediation paths", () => {
    expect(content).toMatch(/exact GitHub \/ GraphQL failure text/i);
    expect(content).toMatch(/Resource not accessible by integration/i);
    expect(content).toMatch(/grant the token Project read\/write access/i);
    expect(content).toMatch(/correct the configured Project number\/owner/i);
  });

  it("branches setup verification severity on required mode", () => {
    expect(content).toMatch(
      /required:\s*false.*warning-level validation failure/i
    );
    expect(content).toMatch(/required:\s*true.*blocking verification failure/i);
    expect(content).toMatch(
      /Repository-local GitHub issue\/PR flows remain usable/i
    );
  });
});
