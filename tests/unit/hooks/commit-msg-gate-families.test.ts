/**
 * Every commit-msg refusal names every gate family the project installs.
 *
 * More than one INDEPENDENT family bites at this one moment, and only one of
 * them used to introduce itself: `lisa-work-item.mjs` prints a five-gate
 * traceability checklist, while commitlint and the AI co-authorship trailer
 * said nothing until they fired. An operator could satisfy every requirement
 * the checklist named and still be refused — which is precisely the property
 * that checklist exists to provide. Measured twice in one day, by two sessions
 * working on opposite sides of the same change.
 *
 * These tests run the real hooks. A summary asserted only against the shared
 * module would pass while no hook called it.
 * @module tests/unit/hooks/commit-msg-gate-families
 */
import type { SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  detectFamilies,
  FAMILIES,
  summary,
} from "../../../all/copy-overwrite/scripts/lisa-commit-msg-gates.mjs";
import {
  boundedExecFileSync,
  boundedSpawnSync,
} from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const GIT = resolveGit();
const BASH = "/bin/bash";
const HOOK_PATH = path.join(REPO_ROOT, ".husky", "commit-msg");
const TRACKER_SCRIPT = path.join(
  REPO_ROOT,
  "all/copy-overwrite/scripts/lisa-work-item.mjs"
);
const GATES_SCRIPT = path.join(
  REPO_ROOT,
  "all/copy-overwrite/scripts/lisa-commit-msg-gates.mjs"
);
/**
 * The directory the staged scripts reach into for their shared modules.
 *
 * A directory, not a file. This named `lib/invoked-as-script.mjs` and stopped
 * being a faithful copy the moment a staged script imported a second sibling
 * (CodySwannGT/lisa#2980) — the fixture then failed with an
 * ERR_MODULE_NOT_FOUND inside `node_modules/@codyswann/lisa/…`, which reads as
 * the published package missing a file rather than as the fixture naming what
 * it should have read. CodySwannGT/lisa#3082.
 */
const ENTRY_GUARD_DIR = path.join(REPO_ROOT, "all/copy-overwrite/scripts/lib");

const TRACEABILITY_TITLE = "Work-Item traceability";
const CONFORMANCE_TITLE = "Conventional commit format";
const COAUTHORSHIP_TITLE = "AI co-authorship";

const WORK_ITEM_TRAILER = "Work-Item: acme/widgets#42";
const CLAUDE_TRAILER = "Co-authored-by: Claude <noreply@anthropic.com>";
const VALID_SUBJECT = "fix: clarify hook output";
const PASSING_COMMITLINT_BIN = "exit 0\n";
const FAILING_COMMITLINT_BIN = [
  "printf '%s\\n' '✖   subject may not be empty [subject-empty]'",
  "exit 1",
].join("\n");

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { force: true, recursive: true });
  tempDirs = [];
});

describe("what the summary reads off a hook", () => {
  const HOOK_SOURCE = readFileSync(HOOK_PATH, "utf8");

  it("finds every family this repository's own hook runs", () => {
    expect(detectFamilies([HOOK_SOURCE]).map(family => family.id)).toEqual([
      "traceability",
      "commit-conformance",
      "ai-coauthorship",
    ]);
  });

  it("names only the families a hook actually installs", () => {
    // A hook that runs commitlint alone must not be described as running three
    // gates. Naming a gate a project does not have is the failure mode that
    // kept this out of the traceability checklist in the first place.
    const detected = detectFamilies(['npx commitlint --edit "$1"']);

    expect(detected.map(family => family.id)).toEqual(["commit-conformance"]);
  });

  it("does not mistake the co-authorship comment for the check", () => {
    // The real hook carries a long comment naming the `Co-Authored-By:`
    // trailer. Matching prose would report the gate as installed in a project
    // that deleted the check and kept the note explaining it.
    const commentOnly = [
      "# The `Co-Authored-By:` trailer is always the last line, so it is",
      "# always the part lost when the message is truncated.",
    ].join("\n");

    expect(detectFamilies([commentOnly])).toEqual([]);
  });

  it("says nothing at all when no family is installed", () => {
    expect(summary([], null)).toBe("");
  });

  it("marks the family that refused, and only that one", () => {
    const text = summary([...FAMILIES], "ai-coauthorship");
    const marked = text
      .split("\n")
      .filter(line => line.includes("← refused this commit"));

    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain(COAUTHORSHIP_TITLE);
  });

  it("counts in the singular when one family is installed", () => {
    expect(summary([FAMILIES[0]], null)).toContain("1 gate family runs");
  });
});

describe("every commit-msg refusal names every family installed", () => {
  it("names all three when the traceability gate refuses", () => {
    const project = createProject({
      commitlintBody: PASSING_COMMITLINT_BIN,
      message: `${VALID_SUBJECT}\n\n${CLAUDE_TRAILER}\n`,
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expectAllThreeNamed(String(result.stdout));
    expect(result.stdout).toContain("1. Work-Item traceability  ←");
  });

  it("names all three when commitlint refuses", () => {
    const project = createProject({
      commitlintBody: FAILING_COMMITLINT_BIN,
      message: `${VALID_SUBJECT}\n\n${WORK_ITEM_TRAILER}\n${CLAUDE_TRAILER}\n`,
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expectAllThreeNamed(String(result.stdout));
    expect(result.stdout).toContain("2. Conventional commit format  ←");
  });

  it("names all three when the co-authorship gate refuses", () => {
    // The measured case: every named requirement satisfied, refused anyway, by
    // a family nothing had mentioned.
    const project = createProject({
      commitlintBody: PASSING_COMMITLINT_BIN,
      message: `${VALID_SUBJECT}\n\n${WORK_ITEM_TRAILER}\n`,
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("must include AI co-authorship");
    expectAllThreeNamed(String(result.stdout));
    expect(result.stdout).toContain("3. AI co-authorship  ←");
  });

  it("names all three when the OpenCode metadata gate refuses", () => {
    const project = createProject({
      commitlintBody: PASSING_COMMITLINT_BIN,
      message: [
        VALID_SUBJECT,
        "",
        WORK_ITEM_TRAILER,
        "Co-authored-by: OpenCode <noreply@opencode.ai>",
        "",
      ].join("\n"),
    });

    const result = runHook(project);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("must include AI metadata trailers");
    expectAllThreeNamed(String(result.stdout));
  });

  it("names only the two families a hook without co-authorship installs", () => {
    // The second half of the contract: the summary must never name a gate the
    // project does not have. Proved by deleting a family from a real hook and
    // refusing on a different one.
    const project = createProject({
      commitlintBody: FAILING_COMMITLINT_BIN,
      message: `${VALID_SUBJECT}\n\n${WORK_ITEM_TRAILER}\n${CLAUDE_TRAILER}\n`,
    });
    const stripped = installStrippedHook(project);

    const result = runHook(project, stripped);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("2 gate families run");
    expect(result.stdout).toContain(TRACEABILITY_TITLE);
    expect(result.stdout).toContain(CONFORMANCE_TITLE);
    expect(result.stdout).not.toContain(COAUTHORSHIP_TITLE);
  });

  it("still accepts a commit that satisfies every family", () => {
    // The control. A diagnostic that also turned refusals into passes would
    // satisfy every assertion above.
    const project = createProject({
      commitlintBody: PASSING_COMMITLINT_BIN,
      message: `${VALID_SUBJECT}\n\n${WORK_ITEM_TRAILER}\n${CLAUDE_TRAILER}\n`,
    });

    const result = runHook(project);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("gate families run");
  });
});

describe("every tracked commit-msg hook introduces what it installs", () => {
  // Derived, never listed. A hardcoded roster is how a third copy of a hook
  // drifts for six commits with every parity test green.
  const HOOKS = boundedExecFileSync({
    label: "git ls-files (commit-msg hooks)",
    command: GIT,
    args: ["ls-files", "*.husky/commit-msg", ".husky/commit-msg"],
    cwd: REPO_ROOT,
  })
    .split("\n")
    .filter(line => line.length > 0);

  it("finds hooks to check at all", () => {
    expect(HOOKS.length).toBeGreaterThanOrEqual(2);
  });

  it.each(HOOKS)("%s calls the summary for every family it runs", hook => {
    const source = readFileSync(path.join(REPO_ROOT, hook), "utf8");

    for (const family of detectFamilies([source])) {
      expect(source).toContain(`lisa_commit_gate_families ${family.id}`);
    }
  });
});

/**
 * Assert the three families this repository installs are all named.
 * @param stdout - Hook output.
 */
function expectAllThreeNamed(stdout: string): void {
  expect(stdout).toContain("3 gate families run");
  expect(stdout).toContain(TRACEABILITY_TITLE);
  expect(stdout).toContain(CONFORMANCE_TITLE);
  expect(stdout).toContain(COAUTHORSHIP_TITLE);
}

/** How to build a temporary project the real hook can run inside. */
type ProjectOptions = {
  readonly commitlintBody: string;
  readonly message: string;
};

/**
 * Create a temporary git project the real commit-msg hook can run against.
 * @param options - Commit message and commitlint behaviour.
 * @returns The temporary project directory.
 */
function createProject(options: ProjectOptions): string {
  const project = mkdtempSync(path.join(tmpdir(), "lisa-gate-families-"));
  const gitEnv = cleanGitEnv(process.env);
  tempDirs.push(project);
  mkdirSync(path.join(project, "node_modules", ".bin"), { recursive: true });
  mkdirSync(path.join(project, "scripts/lib"), { recursive: true });
  writeFileSync(path.join(project, "package-lock.json"), "{}\n");
  writeFileSync(
    path.join(project, ".lisa.config.json"),
    '{"tracker":"github","github":{"org":"acme","repo":"widgets"}}\n'
  );
  writeFileSync(path.join(project, "COMMIT_EDITMSG"), options.message);
  copyFileSync(
    TRACKER_SCRIPT,
    path.join(project, "scripts/lisa-work-item.mjs")
  );
  copyFileSync(
    GATES_SCRIPT,
    path.join(project, "scripts/lisa-commit-msg-gates.mjs")
  );
  cpSync(ENTRY_GUARD_DIR, path.join(project, "scripts/lib"), {
    recursive: true,
  });
  writeBin(project, "npx", options.commitlintBody);
  writeBin(
    project,
    "gh",
    `if [ "\${1:-} \${2:-}" = "api graphql" ]; then
  printf '%s\\n' '{"data":{"repository":{"issue":{"subIssues":{"nodes":[]}}}}}'
else
  printf '%s\\n' '{"number":42,"url":"https://github.com/acme/widgets/issues/42","state":"OPEN","labels":[{"name":"status:in-progress"},{"name":"type:Task"}],"comments":[],"closedByPullRequestsReferences":[]}'
fi\n`
  );
  boundedSpawnSync({
    label: "git init",
    command: GIT,
    args: ["init"],
    cwd: project,
    env: gitEnv,
  });
  boundedSpawnSync({
    label: "git checkout -b",
    command: GIT,
    args: ["checkout", "-b", "codex/issue-1264"],
    cwd: project,
    env: gitEnv,
  });
  return project;
}

/**
 * Install a copy of the real hook with the co-authorship family removed.
 *
 * Cut at the block's own opening comment and closed with an explicit success,
 * so what remains is a hook that genuinely runs two families rather than a
 * hook with a disabled third.
 * @param project - Temporary project directory.
 * @returns Path to the stripped hook.
 */
function installStrippedHook(project: string): string {
  const source = readFileSync(HOOK_PATH, "utf8");
  const marker = "# Check for Co-Authored-By line";
  const cut = source.indexOf(marker);
  if (cut < 0) throw new Error(`${HOOK_PATH} no longer has ${marker}`);
  const hookPath = path.join(project, ".husky", "commit-msg");
  mkdirSync(path.dirname(hookPath), { recursive: true });
  writeFileSync(hookPath, `${source.slice(0, cut)}exit 0\n`);
  return hookPath;
}

/**
 * Run a commit-msg hook against the temp project's commit message.
 * @param project - Temporary project directory.
 * @param hook - Hook to run; the repository's own by default.
 * @returns The completed hook process.
 */
function runHook(
  project: string,
  hook: string = HOOK_PATH
): SpawnSyncReturns<string> {
  return boundedSpawnSync({
    label: "commit-msg hook",
    command: BASH,
    args: [hook, "COMMIT_EDITMSG"],
    cwd: project,
    env: cleanGitEnv(process.env, {
      PATH: `${path.join(project, "node_modules", ".bin")}:${process.env.PATH}`,
    }),
  });
}

/**
 * Write an executable fake binary into the temp project's local bin directory.
 * @param project - Temporary project directory.
 * @param name - Binary filename.
 * @param body - Shell body to execute after the shebang.
 */
function writeBin(project: string, name: string, body: string): void {
  const binPath = path.join(project, "node_modules", ".bin", name);
  writeFileSync(binPath, `#!/usr/bin/env bash\n${body}`);
  chmodSync(binPath, 0o755);
}
