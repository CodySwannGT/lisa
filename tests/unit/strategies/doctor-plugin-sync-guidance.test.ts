/**
 * Regression coverage for doctor plugin-sync next-action guidance.
 *
 * Issue #1095: doctor should surface the smallest useful action for every
 * plugin drift class while keeping /lisa:plugin-sync-explain as deeper context.
 * @module tests/unit/strategies/doctor-plugin-sync-guidance
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createPluginSyncDoctorGroup,
  renderDoctorReport,
} from "../../../plugins/src/base/scripts/doctor-report.mjs";

const SOURCE_SKILL = "plugins/src/base/skills/example/SKILL.md";
const GENERATED_SKILL = "plugins/lisa/skills/example/SKILL.md";

describe("doctor plugin sync guidance (#1095)", () => {
  it.each([
    [
      "SOURCE_NOT_BUILT",
      (root: string) =>
        writeFileSync(path.join(root, SOURCE_SKILL), "\nSource drift.\n", {
          flag: "a",
        }),
      "Next action: run `bun run build:plugins && bun run check:plugins`",
    ],
    [
      "OUT_OF_SYNC",
      (root: string) => {
        writeFileSync(path.join(root, SOURCE_SKILL), "\nSource drift.\n", {
          flag: "a",
        });
        writeFileSync(
          path.join(root, GENERATED_SKILL),
          "\nDifferent generated drift.\n",
          { flag: "a" }
        );
      },
      "keep `plugins/src` authoritative, then run `bun run build:plugins && bun run check:plugins`",
    ],
    [
      "GENERATED_ONLY",
      (root: string) =>
        writeFileSync(
          path.join(root, GENERATED_SKILL),
          "\nGenerated drift.\n",
          {
            flag: "a",
          }
        ),
      "move generated-only edits upstream to `plugins/src`, or remove the generated artifact drift",
    ],
    [
      "MARKETPLACE_REGISTRATION_DRIFT",
      (root: string) =>
        writeFileSync(
          path.join(root, ".claude-plugin/marketplace.json"),
          JSON.stringify({ plugins: [] })
        ),
      "align marketplace registration with the built plugin manifests",
    ],
  ])(
    "renders %s with class-specific next action",
    (driftClass, mutate, expected) => {
      const root = seedPluginRepo();
      try {
        mutate(root);

        const group = createPluginSyncDoctorGroup(root);
        const report = renderDoctorReport({ groups: [group] });

        expect(group.checks[0]).toMatchObject({
          id: "plugin-sync",
          status: "WARN",
          summary: `plugin sync drift detected: ${driftClass}`,
        });
        expect(report.verdict).toBe("READY_WITH_WARNINGS");
        expect(report.text).toContain(expected);
        expect(report.text).toContain(
          "Run `/lisa:plugin-sync-explain` or `bun run check:plugins`"
        );
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    }
  );
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
