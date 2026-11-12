/** Runs only in the controller's inspected disposable container. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = "/lisa-fixture";
const packageFile = "package.json";
assert.ok(
  process.platform === "linux" &&
    process.env.LISA_DISPOSABLE_APPLY === "1" &&
    existsSync("/.dockerenv"),
  "This internal driver requires the inspected disposable-container controller"
);
const proof = {
  harness: process.argv[2],
  native_agent_activation: "not established",
};
const budget = 15 * 60_000;

/**
 * @param {string} command - Genuine runtime tool.
 * @param {string[]} args - Literal arguments.
 * @param {object} options - Additional child options.
 * @returns {string} Actual stdout.
 */
function execute(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: budget,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

/**
 * Resolve actual optional tools without executing them or fabricating a stub.
 * @param {string} name - Native executable basename.
 * @returns {string | null} Existing executable or absence.
 */
function executable(name) {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const file = path.join(directory, name);
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      /* Keep searching PATH. */
    }
  }
  return null;
}

try {
  mkdirSync(root);
  writeFileSync(
    path.join(root, packageFile),
    JSON.stringify({
      name: "lisa-disposable-verification",
      private: true,
      version: "1.0.0",
      type: "module",
      packageManager: "bun@1.4.4",
      trustedDependencies: [
        "@codyswann/lisa",
        "@ast-grep/cli",
        "@parcel/watcher",
        "esbuild",
      ],
    })
  );
  writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
  proof.tools = {
    node: process.version,
    npm: execute("npm", ["--version"]).trim(),
    git: execute("git", ["--version"]).trim(),
    bun: execute("bun", ["--version"]).trim(),
    bash: execute("bash", ["--version"]).split("\n")[0],
    jq: execute("jq", ["--version"]).trim(),
  };
  // Installation and all its lifecycle scripts are inside the checked boundary.
  proof.install_stdout = execute("bun", ["add", "/lisa-input.tgz"]);
  const installed = path.join(root, "node_modules/@codyswann/lisa");
  const manifest = JSON.parse(
    readFileSync(path.join(installed, packageFile), "utf8")
  );
  proof.package = {
    name: manifest.name,
    version: manifest.version,
    bin: manifest.bin,
  };
  assert.equal(manifest.name, "@codyswann/lisa");
  const bin = path.resolve(installed, manifest.bin.lisa);
  assert.ok(bin.startsWith(`${installed}/`));
  const { defaultUserMcpConfigPath } = await import(
    pathToFileURL(path.join(installed, "dist/agy/mcp-installer.js")).href
  );
  proof.destinations = {
    ownership:
      "Every selected writer is inside the disposable root filesystem; zero host mounts",
    project: root,
    agy_user_config: defaultUserMcpConfigPath(),
    temporary_backups: os.tmpdir(),
    update_cache: path.join(
      root,
      "node_modules/.cache/@codyswann/lisa/update-check.json"
    ),
    claude:
      "project instructions; vendor machine plugin registry/cache when CLI exists",
    codex: "project .codex and .agents overlays; optional Sonar integration",
    cursor: "shared project templates/instruction reconciliation",
    agy: "project instructions; unconditional resolved user MCP file; vendor plugins and Sonar",
    copilot: "project instructions; vendor plugin store/cache and Sonar",
    opencode: "project .opencode, opencode.json and instructions",
    devin: "project hook fallback; machine-local vendor plugin store",
    shared:
      "Git common config/hooks, learnings relocation, transaction backups, package-manager caches, detached reconciliation",
    unresolved_vendor_paths:
      "Owned by the same disposable filesystem, including writes from descendants",
  };
  proof.optional_vendor_executables = Object.fromEntries(
    [
      "claude",
      "codex",
      "cursor",
      "agy",
      "copilot",
      "opencode",
      "devin",
      "sonar",
    ].map(name => [name, executable(name)])
  );
  execute("git", ["init", "--initial-branch=main"]);
  execute("git", ["config", "user.name", "Lisa verification"]);
  execute("git", ["config", "user.email", "verification@example.invalid"]);
  execute("git", ["add", "--all"]);
  execute("git", ["commit", "-m", "Initialize disposable fixture"]);
  proof.git_destinations = {
    common: execute("git", ["rev-parse", "--git-common-dir"]).trim(),
    hooks: execute("git", ["rev-parse", "--git-path", "hooks"]).trim(),
  };
  if (process.argv[3] === "failure-control") {
    // Fail the actual user-scope writer AFTER project writes. This is a real
    // filesystem error inside the owned container, never a replacement CLI.
    mkdirSync(defaultUserMcpConfigPath(), { recursive: true });
    proof.failure_control = {
      kind: "agy-config-is-directory",
      path: defaultUserMcpConfigPath(),
    };
  }
  const args = [
    bin,
    "apply",
    root,
    "--yes",
    "--full-apply",
    "--no-update-check",
    "--harness",
    proof.harness,
  ];
  proof.command = [process.execPath, ...args];
  const apply = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, LISA_BOOTSTRAP: "1" },
    encoding: "utf8",
    timeout: budget,
    maxBuffer: 32 * 1024 * 1024,
  });
  proof.apply = {
    status: apply.status,
    signal: apply.signal,
    error: apply.error?.message ?? null,
    stdout: apply.stdout,
    stderr: apply.stderr,
  };
  assert.equal(apply.error, undefined);
  assert.equal(apply.signal, null);
  assert.equal(apply.status, 0);
  const agyConfig = defaultUserMcpConfigPath();
  proof.agy_config_after = existsSync(agyConfig)
    ? {
        present: true,
        sha256: createHash("sha256")
          .update(readFileSync(agyConfig))
          .digest("hex"),
      }
    : { present: false };
  const receipt = JSON.parse(
    readFileSync(path.join(root, ".lisa/apply-receipt.json"), "utf8")
  );
  proof.apply_receipt = receipt;
  assert.equal(receipt.apply_mode, "full");
  // The safety-net hook was removed (CodySwannGT/lisa#4803); a full apply must
  // not ship it. Exercise a surviving emitted guard, keeping every command inert.
  const retired = path.join(root, "scripts/lisa-hooks/parity-safety-net.sh");
  proof.retired_safety_net = { present: existsSync(retired) };
  assert.equal(proof.retired_safety_net.present, false);
  const guard = path.join(root, "scripts/lisa-hooks/block-no-verify.sh");
  const guardBytes = readFileSync(guard);
  proof.guard_sha256 = createHash("sha256").update(guardBytes).digest("hex");
  const prohibited = "git commit --no-verify -m fixture";
  const cases = JSON.parse(readFileSync("/lisa-guard-cases.json", "utf8"));
  assert.equal(cases.length, 14);
  assert.equal(new Set(cases.map(row => row[0])).size, 14);
  proof.guard_cases = [];
  for (const [name, source, expected] of cases) {
    assert.ok(
      typeof name === "string" && !name.includes("/") && !name.includes("..")
    );
    assert.ok(typeof source === "string" && [0, 2].includes(expected));
    const directory = path.join(root, "native-guard-cases", name);
    mkdirSync(path.join(directory, "safe"), { recursive: true });
    writeFileSync(path.join(directory, "payload.sh"), `${prohibited}\n`);
    writeFileSync(path.join(directory, "safe/payload.sh"), "echo safe\n");
    writeFileSync(path.join(directory, "run.sh"), source);
    const result = spawnSync("/bin/bash", [guard], {
      cwd: directory,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, CLAUDE_PROJECT_DIR: directory },
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "sh run.sh" },
      }),
    });
    proof.guard_cases.push({
      name,
      source_sha256: createHash("sha256").update(source).digest("hex"),
      expected,
      status: result.status,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, expected);
  }
  assert.equal(
    createHash("sha256").update(readFileSync(guard)).digest("hex"),
    proof.guard_sha256
  );
  proof.passed = true;
} catch (error) {
  proof.passed = false;
  proof.failure = {
    message: error.message,
    stdout: error.stdout ?? null,
    stderr: error.stderr ?? null,
  };
  process.exitCode = 1;
} finally {
  writeFileSync("/lisa-proof.json", `${JSON.stringify(proof, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      passed: proof.passed,
      harness: proof.harness,
      native_agent_activation: "not established",
    })
  );
}
