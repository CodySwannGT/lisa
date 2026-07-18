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

const VALIDATORS = [
  "lisa-github-validate-issue",
  "lisa-jira-validate-ticket",
  "lisa-linear-validate-issue",
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

describe.each(SKILL_ROOTS)("distributed F5 contract (%s)", skillRoot => {
  it.each(VALIDATORS)(
    "%s requires one target-resource proof per external surface",
    validatorName => {
      const f5 = section(
        read(`${skillRoot}/${validatorName}/SKILL.md`),
        "#### F5 — Required external access provable",
        "## Execution"
      );

      expect(f5).toMatch(/target-resource-specific/);
      expect(f5).toMatch(/preflight checks only/);
      expect(f5).toMatch(/never satisfy F5 by themselves/);
      expect(f5).toMatch(/one surface does not cover another/);
      expect(f5).toMatch(/each succeed separately/);
      expect(f5).toMatch(
        /every required surface has its own successful target-resource read probe/
      );
    }
  );

  it.each(VALIDATORS)(
    "%s permits only brokered or environment-injected credential recovery",
    validatorName => {
      const f5 = section(
        read(`${skillRoot}/${validatorName}/SKILL.md`),
        "#### F5 — Required external access provable",
        "## Execution"
      );

      expect(f5).toMatch(/configured brokered access layer/);
      expect(f5).toMatch(/environment-injected authentication/);
      expect(f5).toMatch(
        /never autonomously inspect, read, copy, print, or export raw/
      );
      expect(f5).toMatch(/keychains, credential files, or token stores/);
      expect(f5).toMatch(/never invoke low-level secret\s+tools/);
      expect(f5).not.toMatch(/a keychain credential/);
    }
  );
});

describe.each(SKILL_ROOTS)("distributed doctor history contract (%s)", root => {
  const doctor = read(`${root}/lisa-doctor/SKILL.md`);

  it("retains commit identity and targeted diff context", () => {
    expect(doctor).toContain("--paginate --slurp |");
    expect(doctor).toMatch(/jq '\{total_commits:/);
    expect(doctor).not.toMatch(/--slurp \\\n\s+--jq/);
    expect(doctor).toContain("commits: [.[].commits[]? | {sha, subject:");
    expect(doctor).toContain("repos/CodySwannGT/lisa/commits/<sha>");
    expect(doctor).toMatch(
      /filename, status, additions, deletions, changes, patch/
    );
    expect(doctor).toMatch(/rather than attributing from the subject alone/);
  });

  it("uses a finite, explicit-ref history fallback", () => {
    expect(doctor).toMatch(/fetch --no-tags --filter=blob:none --depth=256/);
    expect(doctor).toContain('lisa_history_dir="$(mktemp -d)"');
    expect(doctor).toContain("refs/tags/v<installed>:refs/tags/v<installed>");
    expect(doctor).toContain("refs/tags/v<latest>:refs/tags/v<latest>");
    expect(doctor).toMatch(/merge-base --is-ancestor/);
    expect(doctor).toMatch(/Do not\s+silently deepen beyond that ceiling/);
    expect(doctor).not.toContain("git clone --filter=blob:none --no-checkout");
    expect(doctor).not.toContain("shallow-clone");
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
    expect(qualityExample).toMatch(/only records an audit artifact/);
    expect(qualityExample).toMatch(/does not pause the run/);
  });

  it("documents approval inputs as release.yml-only", () => {
    const qualityExample = section(
      actionsGuide,
      "### Compliance Frameworks",
      "### Custom Node Version"
    );

    expect(qualityExample).toMatch(/Do not pass `require_approval` or/);
    expect(qualityExample).toMatch(/those inputs to\s+release.yml/);
    expect(actionsGuide).toMatch(
      /uses: CodySwannGT\/lisa\/\.github\/workflows\/release\.yml@main[\s\S]*require_approval: true[\s\S]*approval_environment: 'production'/
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
