/**
 * Fixture-based verification for `/lisa:plugin-sync-explain`.
 *
 * Issue #990 requires realistic drift fixtures for the diagnostic classes and
 * proves the command's core helper is read-only by comparing git status before
 * and after every run.
 * @module tests/unit/strategies/plugin-sync-explain-fixtures
 */
import { execFileSync } from "node:child_process";
import * as fs from "fs-extra";
import path from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  explainPluginSync,
  getPluginSyncResult,
  renderPluginSyncReport,
} from "../../../plugins/src/base/scripts/plugin-sync-explain.mjs";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const MARKETPLACE = ".claude-plugin/marketplace.json";
const GIT_BIN = "/usr/bin/git";
const SOURCE_SKILL = "plugins/src/base/skills/example/SKILL.md";
const GENERATED_SKILL = "plugins/lisa/skills/example/SKILL.md";

describe("plugin-sync-explain fixture classifications (#990)", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempDir();
    await seedPluginRepo(root);
  });

  afterEach(async () => {
    await cleanupTempDir(root);
  });

  it("classifies source-not-built drift and preserves git status", async () => {
    const sourceFile = path.join(root, SOURCE_SKILL);
    await fs.appendFile(sourceFile, "\nSource-only update.\n");
    const before = gitStatus(root);

    const report = explainPluginSync(root);

    expect(report.readOnly).toBe(true);
    expect(report.statusBefore).toBe(before);
    expect(report.statusAfter).toBe(before);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        classification: "SOURCE_NOT_BUILT",
        path: SOURCE_SKILL,
        counterpart: GENERATED_SKILL,
      })
    );
    expect(report.text).toContain("Verdict: SOURCE_NOT_BUILT");
    expect(gitStatus(root)).toBe(before);
  });

  it("classifies generated-only drift and points back to plugins/src", async () => {
    const generatedFile = path.join(root, GENERATED_SKILL);
    await fs.appendFile(generatedFile, "\nGenerated-only update.\n");
    const before = gitStatus(root);

    const report = explainPluginSync(root);

    expect(report.readOnly).toBe(true);
    expect(report.statusAfter).toBe(before);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        classification: "GENERATED_ONLY",
        path: GENERATED_SKILL,
        counterpart: SOURCE_SKILL,
      })
    );
    expect(report.text).toContain(
      "Move the edit to the matching plugins/src path"
    );
    expect(gitStatus(root)).toBe(before);
  });

  it("does not flag changed generated artifacts that match a scratch build", async () => {
    const replacement =
      "---\nname: example\ndescription: Updated fixture source.\n---\n\n# Example\n";
    await fs.writeFile(path.join(root, SOURCE_SKILL), replacement);
    await fs.writeFile(path.join(root, GENERATED_SKILL), replacement);
    const before = gitStatus(root);

    const report = explainPluginSync(root);

    expect(report.readOnly).toBe(true);
    expect(report.findings).toHaveLength(0);
    expect(report.text).toContain("Verdict: IN_SYNC");
    expect(gitStatus(root)).toBe(before);
  });

  it("reports marketplace registration drift for built plugins missing a source entry", async () => {
    await fs.ensureDir(path.join(root, "plugins/lisa-extra/.claude-plugin"));
    await fs.writeJson(
      path.join(root, "plugins/lisa-extra/.claude-plugin/plugin.json"),
      { name: "lisa-extra", version: "0.0.0" }
    );
    const before = gitStatus(root);

    const report = explainPluginSync(root);

    expect(report.readOnly).toBe(true);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        classification: "MARKETPLACE_REGISTRATION_DRIFT",
        path: "plugins/lisa-extra",
        counterpart: MARKETPLACE,
      })
    );
    expect(report.text).toContain(
      'Add marketplace source "./plugins/lisa-extra"'
    );
    expect(report.text).toContain(MARKETPLACE);
    expect(gitStatus(root)).toBe(before);
  });

  it("renders IN_SYNC when fixtures have no source/generated or marketplace drift", () => {
    const report = explainPluginSync(root);

    expect(report.findings).toHaveLength(0);
    expect(report.readOnly).toBe(true);
    expect(renderPluginSyncReport(report)).toContain("Verdict: IN_SYNC");
  });

  it("exports structured readiness data for doctor consumers", async () => {
    await fs.appendFile(
      path.join(root, SOURCE_SKILL),
      "\nDoctor-visible update.\n"
    );
    const before = gitStatus(root);

    const result = getPluginSyncResult(root);

    expect(result.verdict).toBe("WARN");
    expect(result.driftClass).toBe("SOURCE_NOT_BUILT");
    expect(result.affectedPaths).toEqual([SOURCE_SKILL, GENERATED_SKILL]);
    expect(result.remediations).toContainEqual({
      path: SOURCE_SKILL,
      counterpart: GENERATED_SKILL,
      classification: "SOURCE_NOT_BUILT",
      nextAction:
        "Run `bun run build:plugins`, then `bun run check:plugins`, and commit source plus regenerated artifacts.",
    });
    expect(result.readOnly).toBe(true);
    expect(result.statusAfter).toBe(before);
    expect(gitStatus(root)).toBe(before);
  });
});

/**
 * Seed a minimal committed Lisa plugin tree for drift classification fixtures.
 * @param root Fixture repository root.
 */
async function seedPluginRepo(root: string): Promise<void> {
  await fs.ensureDir(path.join(root, ".claude-plugin"));
  await fs.writeJson(path.join(root, MARKETPLACE), {
    plugins: [{ name: "lisa", source: "./plugins/lisa" }],
  });
  await fs.ensureDir(path.join(root, "plugins/src/base/skills/example"));
  await fs.ensureDir(path.join(root, "plugins/lisa/skills/example"));
  await fs.writeFile(
    path.join(root, SOURCE_SKILL),
    "---\nname: example\ndescription: Fixture source.\n---\n\n# Example\n"
  );
  await fs.writeFile(
    path.join(root, GENERATED_SKILL),
    "---\nname: example\ndescription: Fixture source.\n---\n\n# Example\n"
  );
  await fs.ensureDir(path.join(root, "scripts"));
  await fs.writeFile(
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
}

/**
 * Return plugin-relevant porcelain status for the fixture repo.
 * @param cwd Fixture repository root.
 * @returns Porcelain status output.
 */
function gitStatus(cwd: string): string {
  return git(cwd, "status", "--porcelain", "--", "plugins", MARKETPLACE);
}

/**
 * Run git against a fixture repo with a fixed executable path for lint safety.
 * @param cwd Fixture repository root.
 * @param args Git arguments.
 * @returns Command stdout.
 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_BIN, args, {
    cwd,
    encoding: "utf8",
    env: gitEnv(),
  });
}

/**
 * Remove parent-hook Git environment so fixture commands use the temp repo.
 * @returns Process environment for nested git commands.
 */
function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}
