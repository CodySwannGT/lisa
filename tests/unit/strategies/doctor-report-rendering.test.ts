/**
 * Regression coverage for the shared doctor report renderer.
 *
 * Issue #750 (Story #745, PRD #741): doctor needs a concrete grouped output
 * contract rather than prose-only instructions. This suite proves the shared
 * renderer emits grouped PASS/WARN/FAIL/SKIP checks, keeps observed facts
 * separate from remediation text, and computes the overall verdict ladder.
 * @module tests/unit/strategies/doctor-report-rendering
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  computeDoctorVerdict,
  countDoctorStatuses,
  createPluginSyncDoctorGroup,
  createRepositoryReadinessDoctorGroup,
  renderDoctorReport,
} from "../../../plugins/src/base/scripts/doctor-report.mjs";

const SOURCE_SKILL = "plugins/src/base/skills/example/SKILL.md";
const GENERATED_SKILL = "plugins/lisa/skills/example/SKILL.md";

describe("doctor report rendering (#750)", () => {
  it("renders grouped sections with PASS, WARN, FAIL, and SKIP checks", () => {
    const report = renderDoctorReport({
      generatedAt: "2026-05-25T22:30:00.000Z",
      groups: [
        {
          id: "1",
          title: "Project detection and runtime basics",
          checks: [
            {
              id: "repo-root",
              status: "PASS",
              summary: "repository root resolved",
              observed:
                "package.json and .git are present at the working root.",
            },
            {
              id: "codex-runtime",
              status: "WARN",
              summary:
                "Codex runtime detected without downstream plugin install",
              observed: "The repo exposes source plugin assets only.",
              remediation:
                "Run `bun run build:plugins` before downstream smoke checks.",
            },
          ],
        },
        {
          id: "2",
          title: "Lisa config readiness",
          checks: [
            {
              id: "tracker-config",
              status: "FAIL",
              summary: "configured tracker keys are incomplete",
              observed: "tracker=github but github.repo is missing.",
              remediation:
                "Add `github.repo` to .lisa.config.json or .lisa.config.local.json.",
            },
          ],
        },
        {
          id: "3",
          title: "Optional wiki delegation",
          checks: [
            {
              id: "wiki-checks",
              status: "SKIP",
              summary: "no wiki/ directory detected",
              observed:
                "This repository does not carry the wiki plugin surface.",
            },
          ],
        },
      ],
    });

    expect(report.verdict).toBe("NOT_READY");
    expect(report.counts).toEqual({ PASS: 1, WARN: 1, FAIL: 1, SKIP: 1 });
    expect(report.text).toContain("Overall verdict: NOT_READY");
    expect(report.text).toContain("Counts: 1 PASS, 1 WARN, 1 FAIL, 1 SKIP");
    expect(report.text).toContain("1. Project detection and runtime basics");
    expect(report.text).toContain("- PASS repo-root: repository root resolved");
    expect(report.text).toContain(
      "- WARN codex-runtime: Codex runtime detected without downstream plugin install"
    );
    expect(report.text).toContain(
      "- FAIL tracker-config: configured tracker keys are incomplete"
    );
    expect(report.text).toContain(
      "- SKIP wiki-checks: no wiki/ directory detected"
    );
    expect(report.text).toContain(
      "Observed: tracker=github but github.repo is missing."
    );
    expect(report.text).toContain(
      "Remediation: Add `github.repo` to .lisa.config.json or .lisa.config.local.json."
    );
  });

  it("returns READY when there are no warnings or failures", () => {
    expect(
      computeDoctorVerdict([
        {
          id: "1",
          title: "Runtime distribution surfaces",
          checks: [
            {
              id: "doctor-command",
              status: "PASS",
              summary: "doctor command surface is installed",
            },
            {
              id: "doctor-skill",
              status: "SKIP",
              summary: "runtime-specific subagent check not applicable here",
            },
          ],
        },
      ])
    ).toBe("READY");
  });

  it("returns READY_WITH_WARNINGS when warnings exist without failures", () => {
    expect(
      computeDoctorVerdict([
        {
          id: "1",
          title: "Automation readiness",
          checks: [
            {
              id: "schedule-surface",
              status: "WARN",
              summary: "scheduler runtime not observable from this shell",
            },
          ],
        },
      ])
    ).toBe("READY_WITH_WARNINGS");
  });

  it("never scores an unassessed repository-readiness group as READY (#1897)", () => {
    // The eight readiness dimensions all render SKIP in this Lisa version. An
    // unassessed dimension is silence, not evidence, so the agent-facing
    // scorer must not turn it into a green unattended-fleet claim.
    const group = createRepositoryReadinessDoctorGroup(process.cwd());

    expect(group.checks).toHaveLength(8);
    expect([...new Set(group.checks.map(check => check.status))]).toEqual([
      "SKIP",
    ]);
    expect(computeDoctorVerdict([group])).toBe("READY_WITH_WARNINGS");
  });

  it("still scores a fully assessed repository-readiness group as READY (#1897)", () => {
    expect(
      computeDoctorVerdict([
        {
          id: "repository-readiness",
          title: "Repository readiness",
          checks: [
            {
              id: "context-routing",
              status: "PASS",
              summary: "routing evidence was gathered and holds",
            },
            {
              id: "delivery-authority",
              status: "PASS",
              summary: "what ships equals what was validated",
            },
          ],
        },
      ])
    ).toBe("READY");
  });

  it("counts statuses across all groups", () => {
    expect(
      countDoctorStatuses([
        {
          id: "1",
          title: "A",
          checks: [
            { id: "one", status: "PASS", summary: "ok" },
            { id: "two", status: "WARN", summary: "warn" },
          ],
        },
        {
          id: "2",
          title: "B",
          checks: [
            { id: "three", status: "FAIL", summary: "fail" },
            { id: "four", status: "SKIP", summary: "skip" },
          ],
        },
      ])
    ).toEqual({ PASS: 1, WARN: 1, FAIL: 1, SKIP: 1 });
  });

  it("normalizes invalid statuses before direct aggregation", () => {
    const groups = [
      {
        id: "1",
        title: "Invalid status handling",
        checks: [
          {
            id: "bad-status",
            status: "BANANA",
            summary: "invalid status from an external caller",
          },
        ],
      },
    ];

    expect(computeDoctorVerdict(groups)).toBe("NOT_READY");
    expect(countDoctorStatuses(groups)).toEqual({
      PASS: 0,
      WARN: 0,
      FAIL: 1,
      SKIP: 0,
    });
  });

  it("renders empty groups as grouped skips instead of omitting them", () => {
    const report = renderDoctorReport({
      groups: [{ id: "7", title: "Optional wiki delegation", checks: [] }],
    });

    expect(report.verdict).toBe("READY");
    expect(report.counts).toEqual({ PASS: 0, WARN: 0, FAIL: 0, SKIP: 1 });
    expect(report.text).toContain("7. Optional wiki delegation");
    expect(report.text).toContain(
      "- SKIP empty-group: no checks registered yet"
    );
  });

  it("renders healthy plugin sync as a PASS readiness group", () => {
    const root = seedPluginRepo();
    try {
      const group = createPluginSyncDoctorGroup(root);
      const report = renderDoctorReport({ groups: [group] });

      expect(group.title).toBe("Plugin source/generated sync");
      expect(group.checks[0]).toMatchObject({
        id: "plugin-sync",
        status: "PASS",
        summary: "plugin source and generated artifacts are in sync",
      });
      expect(report.verdict).toBe("READY");
      expect(report.text).toContain("Drift class IN_SYNC");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

/**
 * Seed a minimal committed plugin tree for doctor plugin-sync checks.
 * @returns Fixture repository root.
 */
function seedPluginRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-doctor-plugin-sync-"));
  const skill =
    "---\nname: example\ndescription: Fixture source.\n---\n\n# Example\n";
  mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    path.join(root, ".claude-plugin/marketplace.json"),
    JSON.stringify({ plugins: [{ name: "lisa", source: "./plugins/lisa" }] })
  );
  mkdirSync(path.join(root, "plugins/src/base/skills/example"), {
    recursive: true,
  });
  mkdirSync(path.join(root, "plugins/lisa/skills/example"), {
    recursive: true,
  });
  writeFileSync(path.join(root, SOURCE_SKILL), skill);
  writeFileSync(path.join(root, GENERATED_SKILL), skill);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  writeFileSync(
    path.join(root, "scripts/build-plugins.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"',
      'rm -rf "$ROOT_DIR/plugins/lisa"',
      'mkdir -p "$ROOT_DIR/plugins/lisa"',
      'cp -R "$ROOT_DIR/plugins/src/base/." "$ROOT_DIR/plugins/lisa/"',
      "",
    ].join("\n")
  );
  git(root, "init");
  git(root, "config", "user.email", "lisa-fixture@example.com");
  git(root, "config", "user.name", "Lisa Fixture");
  git(root, "add", ".");
  git(root, "commit", "-m", "seed plugin fixture");
  return root;
}

/**
 * Run a git command in a fixture repository.
 * @param cwd Fixture repository root.
 * @param args Git command arguments.
 * @returns Standard output from git.
 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("/usr/bin/git", args, {
    cwd,
    encoding: "utf8",
    env: gitEnv(),
  });
}

/**
 * Remove parent-hook Git environment so fixture commands use the temp repo.
 * Git exports GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE into hook subprocesses
 * (e.g. the pre-push hook that runs this suite); without stripping them the
 * fixture's `git init` / `git add` operate on the outer repo and fail.
 * @returns Process environment for nested git commands.
 */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}
