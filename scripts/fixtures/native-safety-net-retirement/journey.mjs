/** Genuine released-package → normal candidate update inside a mount-free VM. */
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  load,
  ok,
  run,
  openCodeProbe,
  pluginProbe,
  repositoryProbe,
  sha,
} from "./probes.mjs";

assert.equal(process.platform, "linux");
assert.ok(existsSync("/.dockerenv"));
assert.equal(homedir(), "/root");
const root = "/retirement-project";
const PACKAGE_FILE = "package.json";
const RECEIPT_FILE = ".lisa/apply-receipt.json";
const RETIREMENT_ENTRY = "scripts/retire-native-safety-net.mjs";
const HOST_HOOKS = "scripts/lisa-hooks";
mkdirSync(root);
mkdirSync("/evidence", { mode: 0o700 });
const proof = {
  schema: 1,
  root,
  started_at: new Date().toISOString(),
  boundary:
    "actual emitted registrations and executable handlers; copied installed-handler fixtures are not vendor installations or native sessions",
  commands: [],
  phases: [],
};
const pkg = path.join(root, "node_modules/@codyswann/lisa");
const ports = [
  [
    "claude",
    "lisa",
    ".claude-plugin/plugin.json",
    "/root/.claude/plugins/cache/lisa/lisa/4.90.0",
  ],
  [
    "codex",
    "lisa",
    ".codex-plugin/hooks.json",
    "/root/.codex/plugins/cache/lisa/lisa/4.90.0",
  ],
  [
    "cursor",
    "lisa-cursor",
    "hooks/hooks.json",
    "/root/.cursor/plugins/cache/local/lisa/4.90.0",
  ],
  [
    "copilot",
    "lisa-copilot",
    ".claude-plugin/plugin.json",
    "/root/.copilot/installed-plugins/lisa/lisa",
  ],
  ["devin", "lisa-devin", "hooks.json", "/root/.config/devin/plugins/lisa"],
  ["agy", "lisa-agy", "hooks.json", "/root/.gemini/config/plugins/lisa"],
];

/** Capture literal file bytes without injecting runtime or credential state. */
function snapshot(files) {
  return Object.fromEntries(files.map(file => [file, sha(readFileSync(file))]));
}

/** Every concrete owned handler copy under a chosen fixture directory. */
function handlerFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(
      entry =>
        entry.isFile() &&
        [
          "parity-safety-net.sh",
          "parity-safety-net.agy.sh",
          "lisa-parity-safety-net.ts",
        ].includes(entry.name)
    )
    .map(entry => path.join(entry.parentPath, entry.name));
}

/** Observe package, independent copies and old repository registrations. */
function probe(phase, retired) {
  const channels = [];
  for (const [agent, port, manifest, installed] of ports) {
    // Agy's emitted command resolves its fixed user plugin path. It is
    // instantiated from delivered bytes, with no vendor registry fabricated.
    if (agent !== "agy")
      channels.push(
        pluginProbe(
          proof,
          agent,
          path.join(pkg, "plugins", port, manifest),
          path.join(pkg, "plugins", port),
          retired,
          "actual packaged registration"
        )
      );
    channels.push(
      pluginProbe(
        proof,
        agent,
        path.join(installed, manifest),
        installed,
        retired,
        "independent copied-handler fixture; not vendor installation"
      )
    );
  }
  channels.push(openCodeProbe(proof, retired));
  const repositories = [
    ["claude", ".claude/settings.json"],
    ["codex", ".codex/hooks.json"],
    ["devin", ".devin/hooks.v1.json"],
  ].map(([agent, file]) =>
    repositoryProbe(proof, agent, path.join(root, file), retired)
  );
  const result = { phase, retired, channels, repositories };
  proof.phases.push(result);
  console.log(
    JSON.stringify({
      phase,
      target: retired ? "allowed" : "refused (retirement assertion RED)",
      unrelated: "refused",
      channels: channels.length,
      repositories: repositories.length,
    })
  );
}

/** Explicit real full apply, separately observed from the install lifecycle. */
function apply() {
  // The update leg above/below is measured before this separate full-apply
  // leg. Commit fixture changes normally so the clean-tree check stays on.
  if (ok(proof, "git", ["status", "--porcelain"]).stdout.trim()) {
    ok(proof, "git", ["add", "--all"]);
    ok(proof, "git", ["commit", "-m", "Record isolated upgrade fixture"]);
  }
  return run(
    proof,
    process.execPath,
    [
      path.join(pkg, "dist/index.js"),
      "apply",
      root,
      "--yes",
      "--full-apply",
      "--no-update-check",
      "--harness",
      "fleet",
    ],
    { env: { ...process.env, LISA_BOOTSTRAP: "1" } }
  );
}

try {
  assert.match(ok(proof, "node", ["--version"]).stdout, /^v24\.21\.0\s*$/);
  assert.match(ok(proof, "bun", ["--version"]).stdout, /^1\.4\.4\s*$/);
  writeFileSync(
    path.join(root, PACKAGE_FILE),
    `${JSON.stringify({ name: "retirement-proof", private: true, version: "1.0.0", type: "module", trustedDependencies: ["@codyswann/lisa", "@ast-grep/cli", "@sentry/cli", "esbuild"] }, null, 2)}\n`
  );
  writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
  ok(proof, "bun", ["add", "/baseline.tgz"]);
  assert.equal(load(path.join(pkg, PACKAGE_FILE)).version, "4.90.0");
  assert.equal(
    existsSync(path.join(root, "scripts/lisa-hooks/parity-safety-net.sh")),
    false
  );
  assert.equal(existsSync(path.join(root, RECEIPT_FILE)), false);
  for (const args of [
    ["init", "--initial-branch=main"],
    ["config", "user.name", "Lisa verification"],
    ["config", "user.email", "verification@example.invalid"],
    ["add", "--all"],
    ["commit", "-m", "Initialize isolated baseline"],
  ])
    ok(proof, "git", args);
  apply();
  assert.equal(load(path.join(root, RECEIPT_FILE)).apply_mode, "full");
  for (const [, port, , installed] of ports) {
    mkdirSync(path.dirname(installed), { recursive: true });
    cpSync(path.join(pkg, "plugins", port), installed, { recursive: true });
  }
  probe("released-baseline", false);

  const reduced = "/reduced-core-project";
  mkdirSync(reduced);
  cpSync(path.join(root, HOST_HOOKS), path.join(reduced, HOST_HOOKS), {
    recursive: true,
  });
  cpSync(
    path.join(pkg, "plugins/lisa-agy/hooks/parity-safety-net.agy.sh"),
    path.join(reduced, "scripts/lisa-hooks/parity-safety-net.agy.sh")
  );
  writeFileSync(
    path.join(reduced, PACKAGE_FILE),
    '{"name":"reduced-proof","private":true,"version":"1.0.0"}\n'
  );

  const settingsFile = path.join(root, ".claude/settings.json");
  const settings = load(settingsFile);
  settings.operatorSentinel = { preserve: true };
  settings.hooks.PreToolUse.push({
    matcher: "Bash",
    operatorField: "keep",
    hooks: [
      {
        type: "command",
        command: "printf operator-sentinel",
        operatorField: "keep",
      },
    ],
  });
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  const failure = path.join(root, "node_modules/.lisa/apply-failed.json");
  mkdirSync(path.dirname(failure), { recursive: true });
  writeFileSync(failure, '{"previousFailure":"preserve"}\n');
  const custom = path.join(
    root,
    "plugins/operator-copy/hooks/parity-safety-net.sh"
  );
  mkdirSync(path.dirname(custom), { recursive: true });
  writeFileSync(
    custom,
    `${readFileSync(path.join(pkg, "plugins/lisa/hooks/parity-safety-net.sh"), "utf8")}\n# operator customization\n`
  );
  const preservedFiles = [
    settingsFile,
    failure,
    path.join(root, RECEIPT_FILE),
    custom,
    ...ports.map(([, , , installed]) =>
      path.join(
        installed,
        "hooks",
        installed.includes(".gemini/")
          ? "block-no-verify.agy.sh"
          : "block-no-verify.sh"
      )
    ),
    path.join(root, "scripts/lisa-hooks/block-no-verify.sh"),
  ];
  const before = snapshot(preservedFiles);
  const oldHandlers = [
    ...handlerFiles(path.join(root, HOST_HOOKS)),
    ...handlerFiles(path.join(root, ".opencode/plugin")),
    ...ports.flatMap(([, , , installed]) => handlerFiles(installed)),
  ];
  const oldBytes = snapshot(oldHandlers);

  // Preview the genuine candidate archive at a dependency-shaped fixture path.
  // This is not an update or a substitute for the lifecycle measured below.
  const preview = "/preview/node_modules/@codyswann/lisa";
  mkdirSync(preview, { recursive: true });
  ok(proof, "tar", [
    "-xzf",
    "/candidate.tgz",
    "--strip-components=1",
    "-C",
    preview,
  ]);
  const dry = ok(proof, process.execPath, [
    path.join(preview, RETIREMENT_ENTRY),
    root,
    "--dry-run",
    "--json",
  ]);
  assert.ok(JSON.parse(dry.stdout).some(row => row.status === "would-retire"));
  assert.deepEqual(snapshot(oldHandlers), oldBytes);
  assert.deepEqual(snapshot(preservedFiles), before);

  proof.update = ok(proof, "bun", ["add", "/candidate.tgz"]);
  proof.candidate_package = load(path.join(pkg, PACKAGE_FILE));
  const expected = load(path.join(preview, PACKAGE_FILE));
  assert.equal(proof.candidate_package.version, expected.version);
  // A local candidate can have the same version as the baseline: prove bytes,
  // so reusing an old package-manager cache can never masquerade as retirement.
  for (const file of [
    "scripts/retire-native-safety-net.mjs",
    "plugins/lisa/hooks/parity-safety-net.sh",
    "dist/core/native-safety-net-retirement.js",
  ])
    assert.equal(
      sha(readFileSync(path.join(pkg, file))),
      sha(readFileSync(path.join(preview, file))),
      file
    );
  assert.deepEqual(snapshot(preservedFiles), before);
  assert.notDeepEqual(snapshot(oldHandlers), oldBytes);
  probe("normal-package-update-without-apply", true);
  const retiredBytes = snapshot(oldHandlers);
  ok(proof, process.execPath, [path.join(pkg, RETIREMENT_ENTRY), root]);
  assert.deepEqual(snapshot(oldHandlers), retiredBytes);
  assert.deepEqual(snapshot(preservedFiles), before);
  proof.preservation = {
    before,
    after_update: snapshot(preservedFiles),
    old_handlers_before: oldBytes,
    retired_handlers: retiredBytes,
    dry_run_unchanged: true,
    reconciliation_idempotent: true,
  };

  proof.isolated_linker_update = ok(proof, process.execPath, [
    "/proof/isolated-linker.mjs",
    root,
    preview,
  ]);

  proof.reduced_core_apply = ok(proof, process.execPath, [
    "/proof/reduced-core.mjs",
    pkg,
    reduced,
  ]);

  // Legacy direct CLI postinstall must still stand down after target cleanup.
  ok(proof, process.execPath, [
    path.join(pkg, "dist/index.js"),
    "apply",
    root,
    "--postinstall-safe",
    "--yes",
    "--no-update-check",
  ]);
  assert.deepEqual(snapshot(preservedFiles), before);
  if (proof.candidate_package.lisaReleaseCommit) {
    assert.equal(apply().status, 0);
    probe("explicit-full-apply", true);
    const afterApply = snapshot([settingsFile, ...oldHandlers]);
    assert.equal(apply().status, 0);
    assert.deepEqual(snapshot([settingsFile, ...oldHandlers]), afterApply);
    proof.published_full_apply = {
      status: "established",
      repeat_unchanged: true,
    };
  } else {
    // Local packs have no release identity. Keep that existing refusal intact;
    // the published archive must repeat this journey before tracker closure.
    const rejected = apply();
    assert.equal(rejected.status, 1);
    assert.match(rejected.stdout + rejected.stderr, /no release-commit stamp/);
    proof.published_full_apply = {
      status: "not-established",
      reason:
        "Local candidate is unstamped; repeat against the exact published archive",
      release_pin_refusal_preserved: true,
    };
  }
  assert.equal(load(settingsFile).operatorSentinel.preserve, true);
  assert.equal(
    load(settingsFile).enabledPlugins["safety-net@cc-marketplace"],
    false
  );
  proof.outcome =
    "PASS: genuine baseline RED; normal update retires seven handler surfaces and old copies; unrelated refusals and operator/evidence preservation; dry-run and repeat reconciliation unchanged; published full-apply status recorded separately";
  proof.completed_at = new Date().toISOString();
  writeFileSync(
    "/evidence/retirement-proof.json",
    `${JSON.stringify(proof, null, 2)}\n`
  );
  console.log(proof.outcome);
} catch (error) {
  proof.failure = { message: error.message, stack: error.stack };
  writeFileSync(
    "/evidence/retirement-proof.json",
    `${JSON.stringify(proof, null, 2)}\n`
  );
  console.error(error.stack);
  process.exitCode = 1;
}
