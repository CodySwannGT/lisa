/**
 * Fixture-backed smoke coverage plus exact doctor artifact parity assertions.
 *
 * Issue #756 (Story #748, PRD #741): doctor already has contract-level tests,
 * but it still needs representative readiness fixtures and a strict proof that
 * the generated `plugins/lisa` doctor surfaces stay byte-for-byte aligned with
 * the `plugins/src/base` source assets after `bun run build:plugins`.
 * @module tests/unit/strategies/doctor-fixture-smoke-and-parity
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as fs from "fs-extra";
import path from "node:path";
import process from "node:process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createPluginSyncDoctorGroup,
  renderDoctorReport,
} from "../../../plugins/src/base/scripts/doctor-report.mjs";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/**
 *
 */
type DoctorStatus = "PASS" | "WARN" | "FAIL" | "SKIP";
/**
 *
 */
type DoctorCheck = {
  readonly id: string;
  readonly status: DoctorStatus;
  readonly summary: string;
  readonly observed?: string;
  readonly remediation?: string;
};
/**
 *
 */
type DoctorGroup = {
  readonly id: string;
  readonly title: string;
  readonly checks: readonly DoctorCheck[];
};
/**
 *
 */
type DoctorReportFixture = {
  readonly generatedAt?: string;
  readonly groups: readonly DoctorGroup[];
};

const BASE_PLUGIN_ROOT = path.resolve("plugins/src/base");
const GENERATED_PLUGIN_ROOT = path.resolve("plugins/lisa");
const DOCTOR_FIXTURES = path.resolve("tests/fixtures/doctor");
const MARKETPLACE = ".claude-plugin/marketplace.json";
const GIT_BIN = "/usr/bin/git";
const SOURCE_SKILL = "plugins/src/base/skills/example/SKILL.md";
const GENERATED_SKILL = "plugins/lisa/skills/example/SKILL.md";

const readUtf8 = (filePath: string): string => readFileSync(filePath, "utf8");

const readFixture = (name: string): DoctorReportFixture =>
  JSON.parse(
    readUtf8(path.join(DOCTOR_FIXTURES, `${name}.json`))
  ) as DoctorReportFixture;

describe("doctor fixture smoke coverage (#756)", () => {
  it("renders a missing-config fixture as NOT_READY with actionable failures", () => {
    const report = renderDoctorReport(readFixture("not-ready-missing-config"));

    expect(report.verdict).toBe("NOT_READY");
    expect(report.counts).toEqual({ PASS: 1, WARN: 1, FAIL: 2, SKIP: 0 });
    expect(report.text).toContain("Overall verdict: NOT_READY");
    expect(report.text).toContain(
      "- FAIL config-json: .lisa.config.json is missing"
    );
    expect(report.text).toContain(
      "Observed: No committed Lisa config file was found in the repository root."
    );
    expect(report.text).toContain(
      "Remediation: Create .lisa.config.json with at least tracker and vendor keys before running Lisa workflows."
    );
    expect(report.text).toContain(
      "- FAIL intake-queue: build queue cannot be resolved"
    );
  });

  it("renders a minimally configured GitHub self-host fixture as READY_WITH_WARNINGS", () => {
    const report = renderDoctorReport(
      readFixture("ready-with-warnings-github-self-host")
    );

    expect(report.verdict).toBe("READY_WITH_WARNINGS");
    expect(report.counts).toEqual({ PASS: 3, WARN: 1, FAIL: 0, SKIP: 1 });
    expect(report.text).toContain("Overall verdict: READY_WITH_WARNINGS");
    expect(report.text).toContain(
      "- PASS github-tracker: merged tracker config resolves to GitHub self-host"
    );
    expect(report.text).toContain(
      "- PASS gh-access: gh auth and repo read probe succeeded"
    );
    expect(report.text).toContain(
      "- WARN scheduler-surface: manual Lisa usage is ready, but native scheduler support is unavailable in this runtime"
    );
    expect(report.text).toContain(
      "- SKIP exploratory-bugs: exploratory-bugs is not shipped for this repo surface"
    );
  });
});

describe("doctor plugin sync readiness (#1097)", () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempDir();
    await seedPluginRepo(root);
  });

  afterEach(async () => {
    await cleanupTempDir(root);
  });

  it("collects plugin sync evidence without mutating tracked plugin state", async () => {
    await fs.appendFile(
      path.join(root, SOURCE_SKILL),
      "\nDoctor-visible source update.\n"
    );
    const before = gitStatus(root);

    const group = createPluginSyncDoctorGroup(root);

    expect(group.checks).toContainEqual(
      expect.objectContaining({
        id: "plugin-sync",
        status: "WARN",
        summary: "plugin sync drift detected: SOURCE_NOT_BUILT",
        observed:
          "Drift class SOURCE_NOT_BUILT; affected paths: plugins/src/base/skills/example/SKILL.md, plugins/lisa/skills/example/SKILL.md.",
      })
    );
    expect(gitStatus(root)).toBe(before);
  });
});

describe("doctor source/generated parity (#756)", () => {
  it("keeps the distributed doctor command in lockstep with the source asset", () => {
    expect(
      readUtf8(path.join(GENERATED_PLUGIN_ROOT, "commands", "doctor.md"))
    ).toBe(readUtf8(path.join(BASE_PLUGIN_ROOT, "commands", "doctor.md")));
  });

  it("keeps the distributed doctor skill in lockstep with the source asset", () => {
    expect(
      readUtf8(path.join(GENERATED_PLUGIN_ROOT, "skills", "doctor", "SKILL.md"))
    ).toBe(
      readUtf8(path.join(BASE_PLUGIN_ROOT, "skills", "doctor", "SKILL.md"))
    );
  });

  it("keeps the distributed doctor report helper in lockstep with the source asset", () => {
    expect(
      readUtf8(path.join(GENERATED_PLUGIN_ROOT, "scripts", "doctor-report.mjs"))
    ).toBe(
      readUtf8(path.join(BASE_PLUGIN_ROOT, "scripts", "doctor-report.mjs"))
    );
  });

  it("keeps the distributed plugin sync helper in lockstep with the source asset", () => {
    expect(
      readUtf8(
        path.join(GENERATED_PLUGIN_ROOT, "scripts", "plugin-sync-explain.mjs")
      )
    ).toBe(
      readUtf8(
        path.join(BASE_PLUGIN_ROOT, "scripts", "plugin-sync-explain.mjs")
      )
    );
  });
});

/**
 * Seed a minimal committed Lisa plugin tree for doctor plugin-sync checks.
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
  return env;
}
