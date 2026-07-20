#!/usr/bin/env node
/** Empirical proof for the shipped deterministic Health fast path. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let assertions = 0;
const check = (condition, message) => {
  assertions += 1;
  assert.ok(condition, message);
};
const equal = (actual, expected, message) => {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
};

const root = process.cwd();
const workspace = await mkdtemp(path.join(tmpdir(), "lisa-health-fast-path-"));
const project = path.join(workspace, "host");
const isolatedBin = path.join(workspace, "bin");
const gitExecutable = execFileSync("which", ["git"], {
  encoding: "utf8",
}).trim();
const healthFile = path.join(project, ".lisa", "health", "latest.json");
const startedAt = Date.now();

const run = (executable, argv, options = {}) =>
  execFileSync(executable, argv, {
    cwd: project,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

const git = (...argv) => run(gitExecutable, argv);

async function snapshotTree(directory) {
  const records = [];
  const visit = async (absolute, relative) => {
    const entries = await readdir(absolute, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (relative.length === 0 && entry.name === ".git") continue;
      const childRelative =
        relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
      const childAbsolute = path.join(absolute, entry.name);
      const stat = await lstat(childAbsolute);
      const mode = stat.mode & 0o7777;
      if (stat.isSymbolicLink()) {
        records.push([
          childRelative,
          "symlink",
          mode,
          await readlink(childAbsolute),
        ]);
      } else if (stat.isDirectory()) {
        records.push([childRelative, "directory", mode]);
        await visit(childAbsolute, childRelative);
      } else if (stat.isFile()) {
        const digest = createHash("sha256")
          .update(await readFile(childAbsolute))
          .digest("hex");
        records.push([childRelative, "file", mode, digest]);
      } else {
        records.push([childRelative, "special", mode]);
      }
    }
  };
  await visit(directory, "");
  return records;
}

async function rulesetDocuments() {
  const groups = await Promise.all(
    ["all", "typescript"].map(async type => {
      const directory = path.join(root, type, "github-rulesets");
      return Promise.all(
        (await readdir(directory, { withFileTypes: true }))
          .filter(entry => entry.isFile())
          .map(async entry => {
            const parsed = JSON.parse(
              await readFile(path.join(directory, entry.name), "utf8")
            );
            return {
              name: parsed.name,
              target: parsed.target,
              enforcement: parsed.enforcement,
              conditions: parsed.conditions,
              rules: parsed.rules,
            };
          })
      );
    })
  );
  return Object.values(
    Object.fromEntries(groups.flat().map(document => [document.name, document]))
  );
}

async function assertPureCollection(health, options) {
  const beforeTree = await snapshotTree(project);
  const beforeStatus = git("status", "--porcelain=v1", "--untracked-files=all");
  const beforeExitCode = process.exitCode;
  const beforeHealthFile = await lstat(healthFile)
    .then(() => true)
    .catch(() => false);
  const result = await health.runDeterministicHealth(project, options);
  equal(
    await snapshotTree(project),
    beforeTree,
    "health collection preserves every working-tree inode and byte"
  );
  equal(
    git("status", "--porcelain=v1", "--untracked-files=all"),
    beforeStatus,
    "health collection preserves git status"
  );
  equal(
    process.exitCode,
    beforeExitCode,
    "health collection preserves process exit state"
  );
  equal(
    await lstat(healthFile)
      .then(() => true)
      .catch(() => false),
    beforeHealthFile,
    "health collection never persists latest.json"
  );
  return result;
}

try {
  await mkdir(project, { recursive: true });
  await mkdir(isolatedBin, { recursive: true });
  await symlink(gitExecutable, path.join(isolatedBin, "git"));
  await writeFile(
    path.join(project, "package.json"),
    `${JSON.stringify(
      {
        name: "deterministic-health-fixture",
        private: true,
        devDependencies: { harperdb: "4.6.3", typescript: "5.9.3" },
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    path.join(project, ".lisa.config.json"),
    `${JSON.stringify(
      {
        tracker: "github",
        github: { org: "example", repo: "health-fixture" },
        harness: "claude",
      },
      null,
      2
    )}\n`
  );
  await mkdir(path.join(project, "harper-app"), { recursive: true });
  await writeFile(
    path.join(project, "harper-app", "config.yaml"),
    "graphqlSchema: ./schema.graphql\njsResource: true\nstatic: ./web\n"
  );
  await writeFile(
    path.join(project, "harper-app", "schema.graphql"),
    "type Query { health: Boolean! }\n"
  );
  git("init", "--initial-branch=main");
  git("config", "user.name", "Lisa Health Verifier");
  git("config", "user.email", "health-verifier@example.invalid");
  git("add", ".");
  git("commit", "-m", "fixture bootstrap");

  run(
    process.execPath,
    [
      path.join(root, "dist/index.js"),
      "--no-update-check",
      "apply",
      "--yes",
      "--harness=claude",
      project,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        LISA_BOOTSTRAP: "1",
        LISA_SKIP_UPDATE_CHECK: "1",
        PATH: isolatedBin,
      },
    }
  );
  run(
    process.execPath,
    [path.join(root, "dist/index.js"), "sync", project, "--json"],
    {
      cwd: root,
      env: {
        ...process.env,
        LISA_SKIP_UPDATE_CHECK: "1",
        PATH: isolatedBin,
      },
    }
  );
  const version = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8")
  ).version;
  await writeFile(
    path.join(project, ".claude", ".lisa-plugins-synced"),
    `${version}\n`
  );
  git("add", ".");
  git("commit", "-m", "apply Lisa fixture");

  const health = await import("@codyswann/lisa/health");
  check(
    typeof health.runDeterministicHealth === "function",
    "compiled health export resolves runner"
  );
  const expectedRulesets = await rulesetDocuments();
  const settings = JSON.parse(
    await readFile(path.join(project, ".claude", "settings.json"), "utf8")
  );
  const installedPlugins = Object.entries(settings.enabledPlugins)
    .filter(([, enabled]) => enabled === true)
    .map(([plugin]) => plugin);
  const options = {
    readRulesets: async () => expectedRulesets,
    readHooksPath: async () => ".husky",
    readInstalledPlugins: async () => installedPlugins,
  };

  const clean = await assertPureCollection(health, options);
  equal(clean.mode, "deterministic", "runner returns deterministic mode");
  check(
    clean.findings.every(finding => finding.layer === "deterministic"),
    "only deterministic findings are emitted"
  );
  equal(clean.summary.counts.fail, 0, "clean fixture has zero failures");
  equal(clean.summary.verdict, "in band", "clean fixture is in band");
  equal(
    clean.findings.find(finding => finding.check === "templates.managed")
      .status,
    "pass",
    "the real TypeScript plus Harper child template stack composes cleanly"
  );
  check(
    (await readFile(path.join(project, ".prettierignore"), "utf8")).includes(
      "AI GUARDRAILS HARPER-FABRIC"
    ),
    "the real child copy-contents block survives its parent overwrite"
  );
  equal(
    clean.findings.find(finding => finding.check === "project.wiki").status,
    "pass",
    "the applied fixture has a healthy project wiki"
  );
  equal(
    clean.findings.find(finding => finding.check === "starters.remote").status,
    "warn",
    "offline starter inspection remains an explicit warning"
  );

  const callerPath = path.join(project, ".github", "workflows", "claude.yml");
  const callerOriginal = await readFile(callerPath, "utf8");
  await writeFile(
    callerPath,
    callerOriginal.replace(
      "    with:\n",
      "    with:\n      obsolete_health_input: true\n"
    )
  );
  const staleCaller = await assertPureCollection(health, options);
  const workflowFinding = staleCaller.findings.find(
    finding => finding.check === "ci.workflows"
  );
  equal(workflowFinding.status, "fail", "stale create-only input is a failure");
  check(
    workflowFinding.reason.includes("obsolete_health_input"),
    "stale create-only input is named"
  );
  await writeFile(callerPath, callerOriginal);

  const prettierPath = path.join(project, ".prettierignore");
  const prettierOriginal = await readFile(prettierPath);
  await writeFile(path.join(project, ".lisaignore"), ".prettierignore\n");
  await writeFile(prettierPath, "project-owned while ignored\n");
  const ignoredTemplate = await assertPureCollection(health, options);
  equal(
    ignoredTemplate.findings.find(
      finding => finding.check === "templates.managed"
    ).status,
    "pass",
    "ignored templates are outside Lisa ownership"
  );
  await rm(path.join(project, ".lisaignore"));
  await writeFile(prettierPath, prettierOriginal);

  const deletedWorkflow = path.join(
    project,
    ".github",
    "workflows",
    "quality.yml"
  );
  await writeFile(deletedWorkflow, "name: project-owned deletion fixture\n");
  const deletionOwned = await assertPureCollection(health, options);
  check(
    deletionOwned.findings.every(
      finding => !finding.reason.includes("quality.yml")
    ),
    "pending deletions are excluded from managed ownership"
  );
  await rm(deletedWorkflow);

  const learningsPath = path.join(project, ".lisa", "PROJECT_LEARNINGS.md");
  const learningsOriginal = await readFile(learningsPath);
  const customLearnings = Buffer.from(
    "# Project learnings\n\nHost-owned evidence.\n"
  );
  await writeFile(learningsPath, customLearnings);
  const learningsOwned = await assertPureCollection(health, options);
  equal(
    learningsOwned.findings.find(
      finding => finding.check === "templates.managed"
    ).status,
    "pass",
    "project learnings remain host-owned after their initial seed"
  );
  equal(
    await readFile(learningsPath),
    customLearnings,
    "health preserves project-owned learning bytes"
  );
  await writeFile(learningsPath, learningsOriginal);

  const missingPlugin = await assertPureCollection(health, {
    ...options,
    readInstalledPlugins: async () => [],
  });
  equal(
    missingPlugin.findings.find(finding => finding.check === "plugins.current")
      .status,
    "fail",
    "a current marker cannot hide a missing actual plugin installation"
  );

  const disabledRuleset = await assertPureCollection(health, {
    ...options,
    readRulesets: async () => [
      { ...expectedRulesets[0], enforcement: "disabled" },
      ...expectedRulesets.slice(1),
    ],
  });
  equal(
    disabledRuleset.findings.find(
      finding => finding.check === "github.rulesets"
    ).status,
    "fail",
    "a present but disabled ruleset is material drift"
  );

  const prePushPath = path.join(project, ".husky", "pre-push");
  await chmod(prePushPath, 0o644);
  const nonExecutableHook = await assertPureCollection(health, options);
  equal(
    nonExecutableHook.findings.find(
      finding => finding.check === "hooks.managed"
    ).status,
    "fail",
    "a non-executable managed hook is drift"
  );
  await chmod(prePushPath, 0o755);

  const eslintPath = path.join(project, "eslint.config.ts");
  const eslintOriginal = await readFile(eslintPath);
  await writeFile(
    eslintPath,
    Buffer.concat([eslintOriginal, Buffer.from("\n// health drift\n")])
  );
  const drift = await assertPureCollection(health, options);
  const managedDrift = drift.findings.filter(
    finding =>
      finding.check === "templates.managed" && finding.status === "fail"
  );
  equal(
    managedDrift.length,
    1,
    "managed drift yields exactly one managed-file failure"
  );
  check(
    managedDrift[0].reason.includes("eslint.config.ts"),
    "managed failure names the relative file"
  );
  equal(
    await readFile(eslintPath),
    Buffer.concat([eslintOriginal, Buffer.from("\n// health drift\n")]),
    "drifted bytes remain unchanged"
  );
  console.log("[EVIDENCE: managed-file-drift-fail]");

  await writeFile(eslintPath, eslintOriginal);
  const restored = await assertPureCollection(health, options);
  equal(restored.summary.counts.fail, 0, "restored fixture has zero failures");
  equal(restored.summary.verdict, "in band", "restored fixture is in band");
  console.log("[EVIDENCE: clean-project-in-band]");
  console.log("[EVIDENCE: managed-file-restoration-in-band]");

  const configPath = path.join(project, ".lisa.config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  delete config.github.repo;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const missing = await assertPureCollection(health, options);
  const missingConfig = missing.findings.find(
    finding => finding.check === "config.required"
  );
  equal(missingConfig.status, "fail", "missing required config is a failure");
  check(
    missingConfig.reason.includes("github.repo"),
    "missing finding names the required key"
  );
  check(
    !missingConfig.reason.includes("health-fixture"),
    "missing finding never exposes the removed value"
  );
  console.log("[EVIDENCE: missing-config-key-named]");

  for (const result of [clean, drift, restored, missing]) {
    equal(
      result.mode,
      "deterministic",
      "all proof runs use deterministic mode"
    );
    check(
      result.findings.every(finding => finding.layer === "deterministic"),
      "all proof findings are deterministic"
    );
  }
  console.log("[EVIDENCE: deterministic-only-findings]");

  if (process.platform !== "win32") {
    const unsafeProject = path.join(workspace, "unsafe-host");
    await mkdir(unsafeProject, { recursive: true });
    await writeFile(
      path.join(unsafeProject, ".lisa.config.json"),
      '{"tracker":"github","harness":"codex"}\n'
    );
    execFileSync("mkfifo", [path.join(unsafeProject, "package.json")]);
    const unsafeStarted = Date.now();
    const unsafe = await health.runDeterministicHealth(unsafeProject, {
      lisaRoot: root,
      deadlineMs: 25,
      readRulesets: async () => new Promise(() => undefined),
      readHooksPath: async () => new Promise(() => undefined),
      readInstalledPlugins: async () => new Promise(() => undefined),
    });
    check(
      Date.now() - unsafeStarted < 1_000,
      "FIFO and never-settling injected readers stay under the public deadline"
    );
    equal(
      unsafe.findings.length,
      12,
      "deadline fallback preserves the fixed finding cardinality"
    );
    equal(
      unsafe.findings.find(finding => finding.check === "project.state").status,
      "fail",
      "unsafe FIFO state is surfaced without opening it"
    );
  }

  const elapsedMs = Date.now() - startedAt;
  check(elapsedMs < 120_000, "built proof completes under two minutes");
  console.log("[EVIDENCE: under-two-minute-budget]");
  console.log("[EVIDENCE: no-surprise-side-effects]");
  check(assertions > 0, "proof must execute assertions");
  console.log(
    `health-deterministic assertions=${assertions} elapsedMs=${elapsedMs}`
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}
