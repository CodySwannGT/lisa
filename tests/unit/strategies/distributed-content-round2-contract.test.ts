/**
 * Regression contract for the nine upstream distributed-content findings in
 * #1622. These skills are agent instructions, so the assertions cover the
 * canonical source and every checked-in runtime projection.
 * @module tests/unit/strategies/distributed-content-round2-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;

const section = (
  content: string,
  startHeading: string,
  nextHeading: string
): string => {
  const start = content.indexOf(startHeading);
  const end = content.indexOf(nextHeading, start + startHeading.length);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return content.slice(start, end);
};

describe.each(SKILL_ROOTS)("distributed doctor history contract (%s)", root => {
  // #1582 extracted the upstream-history procedure out of lisa-doctor into the
  // shared, event-triggered lisa-attribute-failure skill. The #1622 hardening
  // contract now binds wherever the procedure lives; doctor must delegate.
  const attribution = read(`${root}/lisa-attribute-failure/SKILL.md`);
  const doctor = read(`${root}/lisa-doctor/SKILL.md`);

  it("retains commit identity and targeted diff context", () => {
    expect(attribution).toContain("--paginate --slurp |");
    expect(attribution).not.toMatch(/--slurp \\\n\s+--jq/);
  });

  it("uses a finite, explicit-ref history fallback", () => {
    expect(attribution).toMatch(
      /fetch --no-tags --filter=blob:none --depth=256/
    );
    expect(attribution).toContain(
      "refs/tags/v<installed>:refs/tags/v<installed>"
    );
    expect(attribution).toContain("refs/tags/v<latest>:refs/tags/v<latest>");
    expect(attribution).toMatch(/merge-base --is-ancestor/);
    expect(attribution).not.toContain(
      "git clone --filter=blob:none --no-checkout"
    );
  });

  it("keeps doctor's diagnosis as a thin delegation without regressing it", () => {
    expect(doctor).toContain("lisa-attribute-failure");
  });
});

describe.each([
  "typescript/copy-overwrite/.github/GITHUB_ACTIONS.md",
  ".github/GITHUB_ACTIONS.md",
])("GitHub Actions approval examples (%s)", actionsGuidePath => {
  const actionsGuide = read(actionsGuidePath);

  it("keeps approval inputs out of the quality.yml compliance example", () => {
    const qualityExample = section(
      actionsGuide,
      "### Compliance Frameworks",
      "### Custom Node Version"
    );
    const yaml = section(qualityExample, "```yaml", "```");

    expect(yaml).toContain("quality.yml");
    expect(yaml).not.toContain("require_approval");
    expect(yaml).not.toContain("approval_environment");
  });

  it("documents approval inputs as release.yml-only", () => {
    const qualityExample = section(
      actionsGuide,
      "### Compliance Frameworks",
      "### Custom Node Version"
    );

    expect(qualityExample).toMatch(/Do not pass `require_approval` or/);
    // The ref in the example is deliberately a placeholder for the pinned
    // form rather than `@main`: since CodySwannGT/lisa#3893 every caller Lisa
    // writes names a full commit SHA, and a guide that showed `@main` would
    // document the defect as the recipe.
    expect(actionsGuide).toMatch(
      /uses: CodySwannGT\/lisa\/\.github\/workflows\/release\.yml@<40-character commit sha> # v<x\.y\.z>[\s\S]*require_approval: true[\s\S]*approval_environment: 'production'/
    );
  });
});

describe("OpenCode distribution", () => {
  it("continues to copy the corrected bundled skills verbatim", () => {
    const installer = read("src/opencode/skills-installer.ts");

    expect(installer).toMatch(/Copy one bundled skill folder verbatim/);
    expect(installer).toContain("await copyFile(srcPath, destPath)");
  });
});
