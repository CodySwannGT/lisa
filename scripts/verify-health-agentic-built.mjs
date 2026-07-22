#!/usr/bin/env node
/** Empirical proof for the shipped optional agentic Health composition API. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
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
const findingState = finding => ({
  check: finding.check,
  layer: finding.layer,
  status: finding.status,
  reason: finding.reason,
});
const deterministicState = result => ({
  schemaVersion: result.schemaVersion,
  projectRoot: result.projectRoot,
  mode: result.mode,
  startedAt: result.startedAt,
  completedAt: result.completedAt,
  summary: result.summary,
  findings: result.findings,
});
const printStateDump = (name, payload) => {
  const serialized = JSON.stringify({ name, ...payload });
  check(
    Buffer.byteLength(serialized, "utf8") <= 16 * 1024,
    `${name} state dump stays within 16 KiB`
  );
  console.log(serialized);
};

const root = process.cwd();
const workspace = await mkdtemp(path.join(tmpdir(), "lisa-health-agentic-"));
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

/** Capture every non-git working-tree inode, mode, target, and file digest. */
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
        records.push([
          childRelative,
          "file",
          mode,
          createHash("sha256")
            .update(await readFile(childAbsolute))
            .digest("hex"),
        ]);
      } else {
        records.push([childRelative, "special", mode]);
      }
    }
  };
  await visit(directory, "");
  return records;
}

/** Read the exact material ruleset documents shipped by the fixture stack. */
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

/** Run one collection and prove it cannot mutate project, storage, git, or exit state. */
async function assertPureCollection(collect) {
  const beforeTree = await snapshotTree(project);
  const beforeStatus = git("status", "--porcelain=v1", "--untracked-files=all");
  const beforeExitCode = process.exitCode;
  const beforeHealthFile = await lstat(healthFile)
    .then(() => true)
    .catch(() => false);
  const result = await collect();
  equal(
    await snapshotTree(project),
    beforeTree,
    "agentic composition preserves every working-tree inode and byte"
  );
  equal(
    git("status", "--porcelain=v1", "--untracked-files=all"),
    beforeStatus,
    "agentic composition preserves git status"
  );
  equal(
    process.exitCode,
    beforeExitCode,
    "agentic composition preserves process exit state"
  );
  equal(
    await lstat(healthFile)
      .then(() => true)
      .catch(() => false),
    beforeHealthFile,
    "agentic composition never persists latest.json"
  );
  return result;
}

/** Return the artifact-first bounded evaluator used by the empirical journey. */
function artifactEvaluator(request, signal) {
  check(!signal.aborted, "evaluator receives a live abort signal");
  check(Object.isFrozen(request), "evaluator request is frozen");
  check(
    Object.isFrozen(request.deterministicFindings) &&
      request.deterministicFindings.every(Object.isFrozen),
    "deterministic evidence is deeply frozen"
  );
  check(
    Object.isFrozen(request.config) &&
      Object.isFrozen(request.config.quality) &&
      Object.isFrozen(request.config.quality.mutation) &&
      Object.isFrozen(request.config.quality.mutation.gate),
    "config projection is deeply frozen"
  );
  check(
    Object.isFrozen(request.artifacts) &&
      request.artifacts.every(Object.isFrozen),
    "artifact evidence is deeply frozen"
  );
  equal(
    Object.hasOwn(request, "projectRoot"),
    false,
    "bounded evaluator request exposes no filesystem capability"
  );
  equal(
    Reflect.set(request.config.quality.mutation.gate, "enabled", true),
    false,
    "frozen config resists evaluator mutation"
  );
  if (request.artifacts.length > 0) {
    equal(
      Reflect.set(request.artifacts[0], "content", "tampered"),
      false,
      "frozen artifacts resist evaluator mutation"
    );
  }
  check(
    request.artifacts.every(
      artifact =>
        !path.isAbsolute(artifact.path) &&
        !artifact.path.split("/").includes("..") &&
        Buffer.byteLength(artifact.content, "utf8") <= 128 * 1024
    ),
    "every evaluator artifact is relative and individually bounded"
  );
  check(
    request.artifacts.reduce(
      (total, artifact) => total + Buffer.byteLength(artifact.content, "utf8"),
      0
    ) <=
      512 * 1024,
    "aggregate evaluator evidence is bounded"
  );

  const judgments = [];
  const override = request.artifacts.find(
    artifact => artifact.kind === "eslint-override"
  );
  const managedArtifact = request.artifacts.find(
    artifact => artifact.kind === "managed-drift"
  );
  const workflows = request.artifacts.filter(
    artifact => artifact.kind === "workflow"
  );
  const mutationDisabled =
    request.config.quality.mutation.gate.enabled === false;
  const managedDrift = request.deterministicFindings.find(
    finding =>
      finding.check === "templates.managed" && finding.status === "fail"
  );

  if (mutationDisabled) {
    judgments.push({
      check: "agentic.disabled-mutation-gate",
      reason:
        "The mutation-testing gate is disabled without a justification in the bounded configuration evidence.",
    });
  }
  if (
    override?.content.includes("no-explicit-any") === true &&
    !/\b(?:reason|justification)\b/iu.test(override.content)
  ) {
    judgments.push({
      check: "agentic.eslint.override",
      reason:
        "eslint.config.local.ts disables no-explicit-any without a recorded justification.",
    });
  }
  for (const workflow of workflows) {
    if (
      /skip_jobs:\s*['"]?lint['"]?/u.test(workflow.content) &&
      !/\b(?:reason|justification)\b/iu.test(workflow.content)
    ) {
      judgments.push({
        check: "agentic.ci.skip.lint",
        reason: `${workflow.path} skips lint without a recorded justification.`,
      });
    }
  }
  if (
    managedDrift?.reason.includes("eslint.config.ts") === true &&
    /\b(?:reason|justification)\b/iu.test(override?.content ?? "") &&
    managedArtifact?.content.includes("no-explicit-any") === true &&
    /["']off["']/u.test(managedArtifact.content)
  ) {
    judgments.push({
      check: "agentic.intentional-drift",
      reason:
        "The bounded managed ESLint drift disables no-explicit-any despite the recorded temporary justification.",
    });
  }
  return Promise.resolve({ status: "completed", judgments });
}

try {
  await mkdir(project, { recursive: true });
  await mkdir(isolatedBin, { recursive: true });
  await symlink(gitExecutable, path.join(isolatedBin, "git"));
  await writeFile(
    path.join(project, "package.json"),
    `${JSON.stringify(
      {
        name: "agentic-health-fixture",
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
    typeof health.runHealth === "function",
    "built package exports runHealth"
  );
  const expectedRulesets = await rulesetDocuments();
  const settings = JSON.parse(
    await readFile(path.join(project, ".claude", "settings.json"), "utf8")
  );
  const installedPlugins = Object.entries(settings.enabledPlugins)
    .filter(([, enabled]) => enabled === true)
    .map(([plugin]) => plugin);
  const offline = {
    readRulesets: async () => expectedRulesets,
    readHooksPath: async () => ".husky",
    readInstalledPlugins: async () => installedPlugins,
  };

  let disabledCalls = 0;
  const deterministic = await assertPureCollection(() =>
    health.runHealth(project, {
      ...offline,
      agentic: {
        enabled: false,
        evaluator: async () => {
          disabledCalls += 1;
          throw new Error("disabled evaluator must not run");
        },
      },
    })
  );
  const full = await assertPureCollection(() =>
    health.runHealth(project, {
      ...offline,
      agentic: { enabled: true, evaluator: artifactEvaluator },
    })
  );
  const completedEmpty = await assertPureCollection(() =>
    health.runHealth(project, {
      ...offline,
      agentic: {
        enabled: true,
        evaluator: async () => ({ status: "completed", judgments: [] }),
      },
    })
  );
  equal(disabledCalls, 0, "disabled agentic pass never calls evaluator");
  equal(
    deterministic.mode,
    "deterministic",
    "disabled pass stays deterministic"
  );
  equal(full.mode, "full", "enabled completed pass reports full mode");
  equal(
    completedEmpty.mode,
    "full",
    "completed evaluator with no judgments still reports full mode"
  );
  equal(
    completedEmpty.findings.filter(finding => finding.layer === "agentic"),
    [],
    "completed evaluator with no judgments fabricates no agentic finding"
  );
  equal(
    full.findings.filter(finding => finding.layer === "deterministic"),
    deterministic.findings,
    "composition preserves deterministic facts exactly"
  );
  check(
    full.findings.some(
      finding =>
        finding.check === "agentic.disabled-mutation-gate" &&
        finding.status === "warn"
    ),
    "config-backed disabled mutation gate reaches the evaluator"
  );
  check(
    Object.isFrozen(full) &&
      Object.isFrozen(full.findings) &&
      full.findings.every(Object.isFrozen) &&
      Object.isFrozen(full.summary) &&
      Object.isFrozen(full.summary.counts),
    "composed result is deeply frozen"
  );
  printStateDump("agentic-api-diff", {
    disabled: {
      mode: deterministic.mode,
      agenticFindings: deterministic.findings
        .filter(finding => finding.layer === "agentic")
        .map(findingState),
    },
    enabled: {
      mode: full.mode,
      agenticFindings: full.findings
        .filter(finding => finding.layer === "agentic")
        .map(findingState),
    },
    completedWithNoJudgments: {
      mode: completedEmpty.mode,
      agenticFindings: completedEmpty.findings
        .filter(finding => finding.layer === "agentic")
        .map(findingState),
    },
    deterministicFindingsPreserved:
      JSON.stringify(
        full.findings.filter(finding => finding.layer === "deterministic")
      ) === JSON.stringify(deterministic.findings),
  });
  console.log("[EVIDENCE: state-dump: agentic-api-diff]");

  const localEslintPath = path.join(project, "eslint.config.local.ts");
  const localEslintOriginal = await readFile(localEslintPath);
  await writeFile(
    localEslintPath,
    'export default [{ rules: { "@typescript-eslint/no-explicit-any": "off" } }];\n'
  );
  const unjustified = await assertPureCollection(() =>
    health.runHealth(project, {
      ...offline,
      agentic: { enabled: true, evaluator: artifactEvaluator },
    })
  );
  const overrideWarning = unjustified.findings.find(
    finding => finding.check === "agentic.eslint.override"
  );
  equal(overrideWarning?.layer, "agentic", "override warning is agentic");
  equal(overrideWarning?.status, "warn", "override judgment can never fail");
  check(
    overrideWarning?.reason.includes("eslint.config.local.ts") === true,
    "override warning carries operator-readable reasoning"
  );
  printStateDump("unjustified-override-warning", {
    warning: findingState(overrideWarning),
  });
  console.log("[EVIDENCE: state-dump: unjustified-override-warning]");
  await writeFile(localEslintPath, localEslintOriginal);

  const ciPath = path.join(project, ".github", "workflows", "ci.yml");
  const ciOriginal = await readFile(ciPath, "utf8");
  await writeFile(
    ciPath,
    ciOriginal.replace("skip_jobs: ''", "skip_jobs: 'lint'")
  );
  const unreasonedSkip = await assertPureCollection(() =>
    health.runHealth(project, {
      ...offline,
      agentic: { enabled: true, evaluator: artifactEvaluator },
    })
  );
  check(
    unreasonedSkip.findings.some(
      finding =>
        finding.check === "agentic.ci.skip.lint" &&
        finding.reason.includes("ci.yml")
    ),
    "unreasoned skipped job produces a named warning"
  );
  await writeFile(
    ciPath,
    ciOriginal.replace(
      "      skip_jobs: ''",
      "      # justification: lint is temporarily enforced by a protected external gate\n      skip_jobs: 'lint'"
    )
  );
  const reasonedSkip = await assertPureCollection(() =>
    health.runHealth(project, {
      ...offline,
      agentic: { enabled: true, evaluator: artifactEvaluator },
    })
  );
  check(
    !reasonedSkip.findings.some(
      finding => finding.check === "agentic.ci.skip.lint"
    ),
    "recorded skip justification clears the job warning"
  );
  printStateDump("skipped-job-reason-clears", {
    undocumented: unreasonedSkip.findings
      .filter(finding => finding.check === "agentic.ci.skip.lint")
      .map(findingState),
    documented: reasonedSkip.findings
      .filter(finding => finding.check === "agentic.ci.skip.lint")
      .map(findingState),
  });
  console.log("[EVIDENCE: state-dump: skipped-job-reason-clears]");
  await writeFile(ciPath, ciOriginal);

  const managedEslintPath = path.join(project, "eslint.config.ts");
  const managedEslintOriginal = await readFile(managedEslintPath);
  const managedJustification =
    '// justification: temporary vendor migration\nexport default [{ rules: { "@typescript-eslint/no-explicit-any": "off" } }];\n';
  await writeFile(localEslintPath, managedJustification);
  const observedManagedArtifacts = [];
  const managedEvidenceEvaluator = (request, signal) => {
    const managed = request.artifacts.find(
      artifact => artifact.kind === "managed-drift"
    );
    observedManagedArtifacts.push(managed);
    return artifactEvaluator(request, signal);
  };
  const benignManagedContent = Buffer.concat([
    managedEslintOriginal,
    Buffer.from("\n// formatting-only managed drift\n"),
  ]);
  const suspiciousManagedContent = Buffer.concat([
    managedEslintOriginal,
    Buffer.from(
      '\nvoid { "@typescript-eslint/no-explicit-any": "off" }; // suspicious managed drift\n'
    ),
  ]);
  await writeFile(managedEslintPath, benignManagedContent);
  const benignDrift = await assertPureCollection(() =>
    health.runHealth(project, {
      ...offline,
      agentic: { enabled: true, evaluator: managedEvidenceEvaluator },
    })
  );
  await writeFile(managedEslintPath, suspiciousManagedContent);
  const suspiciousDrift = await assertPureCollection(() =>
    health.runHealth(project, {
      ...offline,
      agentic: { enabled: true, evaluator: managedEvidenceEvaluator },
    })
  );
  equal(
    observedManagedArtifacts.map(artifact => artifact?.path),
    ["eslint.config.ts", "eslint.config.ts"],
    "both drift judgments inspect the bounded managed ESLint artifact"
  );
  equal(
    observedManagedArtifacts.map(artifact => artifact?.content),
    [
      benignManagedContent.toString("utf8"),
      suspiciousManagedContent.toString("utf8"),
    ],
    "managed-drift evidence carries the current confined content"
  );
  check(
    benignDrift.findings.some(
      finding =>
        finding.check === "templates.managed" && finding.status === "fail"
    ),
    "benign agentic judgment cannot erase deterministic managed drift"
  );
  check(
    !benignDrift.findings.some(
      finding => finding.check === "agentic.intentional-drift"
    ),
    "benign managed content produces no drift judgment"
  );
  const suspiciousDriftWarning = suspiciousDrift.findings.find(
    finding => finding.check === "agentic.intentional-drift"
  );
  equal(
    suspiciousDriftWarning?.status,
    "warn",
    "suspicious rule-disabling managed content produces a warning"
  );
  equal(
    await readFile(localEslintPath, "utf8"),
    managedJustification,
    "both managed-drift judgments use the same recorded justification"
  );
  printStateDump("managed-drift-content-judgment", {
    sameJustification: true,
    benign: {
      contentSha256: createHash("sha256")
        .update(benignManagedContent)
        .digest("hex"),
      warnings: benignDrift.findings
        .filter(finding => finding.check === "agentic.intentional-drift")
        .map(findingState),
    },
    suspicious: {
      contentSha256: createHash("sha256")
        .update(suspiciousManagedContent)
        .digest("hex"),
      warnings: suspiciousDrift.findings
        .filter(finding => finding.check === "agentic.intentional-drift")
        .map(findingState),
    },
  });
  await writeFile(managedEslintPath, managedEslintOriginal);
  await writeFile(localEslintPath, localEslintOriginal);

  let timeoutEvaluatorStarted = 0;
  let timeoutAbortObserved = 0;
  let unavailableProjection;
  const degradationCases = [
    {
      name: "unavailable",
      evaluator: async () => ({ status: "unavailable" }),
      timeoutMs: 1_000,
    },
    {
      name: "throw",
      evaluator: async () => {
        throw new Error("secret evaluator failure must not escape");
      },
      timeoutMs: 1_000,
    },
    {
      name: "malformed",
      evaluator: async () => ({
        status: "completed",
        judgments: [{ check: "templates.managed", reason: "collision" }],
      }),
      timeoutMs: 1_000,
    },
    {
      name: "timeout",
      evaluator: async (_request, signal) =>
        new Promise(resolve => {
          timeoutEvaluatorStarted += 1;
          signal.addEventListener(
            "abort",
            () => {
              timeoutAbortObserved += 1;
              resolve({
                status: "completed",
                judgments: [
                  {
                    check: "agentic.late-timeout",
                    reason:
                      "This late judgment must be discarded after cancellation.",
                  },
                ],
              });
            },
            { once: true }
          );
        }),
      timeoutMs: 400,
    },
  ];
  for (const scenario of degradationCases) {
    const scenarioStarted = Date.now();
    const degraded = await assertPureCollection(() =>
      health.runHealth(project, {
        ...offline,
        agentic: {
          enabled: true,
          evaluator: scenario.evaluator,
          timeoutMs: scenario.timeoutMs,
        },
      })
    );
    equal(
      degraded.mode,
      "deterministic",
      `${scenario.name} evaluator degrades to deterministic mode`
    );
    check(
      degraded.findings.every(finding => finding.layer === "deterministic"),
      `${scenario.name} evaluator fabricates no judgment finding`
    );
    check(
      !JSON.stringify(degraded).includes("secret evaluator failure"),
      `${scenario.name} evaluator leaks no raw failure`
    );
    if (scenario.name === "timeout") {
      equal(
        timeoutEvaluatorStarted,
        1,
        "timeout proof reaches the evaluator after evidence collection"
      );
      equal(
        timeoutAbortObserved,
        1,
        "never-settling evaluator observes the shared abort signal"
      );
      check(
        !degraded.findings.some(
          finding => finding.check === "agentic.late-timeout"
        ),
        "a judgment resolved during abort is discarded"
      );
      check(
        Date.now() - scenarioStarted < 1_500,
        "never-settling evaluator returns inside its bounded deadline plus fixture overhead"
      );
    }
    if (scenario.name === "unavailable") {
      unavailableProjection = {
        mode: degraded.mode,
        findings: degraded.findings.map(findingState),
      };
    }
  }
  printStateDump("unavailable-evaluator-degrades", {
    unavailable: unavailableProjection,
    agenticFindings: unavailableProjection.findings.filter(
      finding => finding.layer === "agentic"
    ),
  });
  console.log("[EVIDENCE: state-dump: unavailable-evaluator-degrades]");

  const escapingEvidence = path.join(workspace, "escaping-eslint-evidence.ts");
  await writeFile(
    escapingEvidence,
    "// reason: this content is outside the project and must never reach the evaluator\nexport default [];\n"
  );
  await rm(localEslintPath, { force: true });
  await symlink(escapingEvidence, localEslintPath);
  let hostileEvaluatorCalls = 0;
  const hostileNow = () => new Date("2026-07-20T12:00:00.000Z");
  try {
    const hostileBaseline = await assertPureCollection(() =>
      health.runHealth(project, {
        ...offline,
        now: hostileNow,
        agentic: { enabled: false },
      })
    );
    const hostileDegraded = await assertPureCollection(() =>
      health.runHealth(project, {
        ...offline,
        now: hostileNow,
        agentic: {
          enabled: true,
          evaluator: async () => {
            hostileEvaluatorCalls += 1;
            return { status: "completed", judgments: [] };
          },
        },
      })
    );
    equal(
      hostileEvaluatorCalls,
      0,
      "escaping symlink evidence is rejected before evaluator invocation"
    );
    equal(
      deterministicState(hostileDegraded),
      deterministicState(hostileBaseline),
      "unsafe evidence degrades to the exact deterministic-only projection"
    );
    equal(
      hostileDegraded.mode,
      "deterministic",
      "unsafe evidence retains deterministic mode"
    );
    check(
      hostileDegraded.findings.every(
        finding => finding.layer === "deterministic"
      ),
      "unsafe evidence fabricates no agentic finding"
    );
  } finally {
    await rm(localEslintPath, { force: true });
    await writeFile(localEslintPath, localEslintOriginal);
  }
  equal(
    await readFile(localEslintPath),
    localEslintOriginal,
    "hostile evidence fixture restores the original local override"
  );
  console.log("[EVIDENCE: hostile-agentic-degradation]");
  console.log("[EVIDENCE: no-agentic-side-effects]");

  const elapsedMs = Date.now() - startedAt;
  check(elapsedMs < 120_000, "built agentic proof completes under two minutes");
  check(assertions > 0, "proof must execute assertions");
  console.log(`health-agentic assertions=${assertions} elapsedMs=${elapsedMs}`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
