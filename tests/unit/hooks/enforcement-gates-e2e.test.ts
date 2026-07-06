/**
 * End-to-end verifier tests for Lisa enforcement gates in downstream projects.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const BASH = "/bin/bash";
const AST_GREP = path.join(REPO_ROOT, "node_modules", ".bin", "ast-grep");
const AST_GREP_DIR = "ast-grep";
const COPY_OVERWRITE_DIR = "copy-overwrite";
const SGCONFIG_FILENAME = "sgconfig.yml";
const RULE_SENTINEL = "VERIFY-THE-VERIFIER-RULE-CONTEXT";

const HOOK_RUNTIMES = [
  {
    name: "Claude plugin",
    typeScriptHook: "plugins/lisa-typescript/hooks/sg-scan-on-edit.sh",
    railsSgHook: "plugins/lisa-rails/hooks/sg-scan-on-edit.sh",
    railsRuboCopHook: "plugins/lisa-rails/hooks/rubocop-on-edit.sh",
    injectRulesHook: "plugins/lisa/hooks/inject-rules.sh",
  },
  {
    name: "Cursor plugin",
    typeScriptHook: "plugins/lisa-typescript-cursor/hooks/sg-scan-on-edit.sh",
    railsSgHook: "plugins/lisa-rails-cursor/hooks/sg-scan-on-edit.sh",
    railsRuboCopHook: "plugins/lisa-rails-cursor/hooks/rubocop-on-edit.sh",
  },
  {
    name: "Copilot plugin",
    typeScriptHook: "plugins/lisa-typescript-copilot/hooks/sg-scan-on-edit.sh",
    railsSgHook: "plugins/lisa-rails-copilot/hooks/sg-scan-on-edit.sh",
    railsRuboCopHook: "plugins/lisa-rails-copilot/hooks/rubocop-on-edit.sh",
    injectRulesHook: "plugins/lisa-copilot/hooks/inject-rules.sh",
  },
] as const;

/** Spawn result returned by shell hook executions. */
type HookResult = ReturnType<typeof spawnSync<string>>;

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs = [];
});

describe("downstream enforcement gates", () => {
  it.each(HOOK_RUNTIMES)(
    "$name TypeScript ast-grep hook blocks and returns scan feedback",
    runtime => {
      const project = createTypeScriptProject();
      const filePath = writeProjectFile(
        project,
        "src/features/demo/components/Foo/FooView.tsx",
        'const Foo = () => null;\nFoo.displayName = "Wrong";\n'
      );

      const result = runEditHook(runtime.typeScriptHook, project, filePath);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("ast-grep found issues");
      expect(result.stderr).toContain("no-inline-component-in-view");
    }
  );

  it.each(HOOK_RUNTIMES)(
    "$name Rails ast-grep hook blocks and returns scan feedback",
    runtime => {
      const project = createRailsProject();
      const filePath = writeProjectFile(
        project,
        "app/models/user.rb",
        'class User < ApplicationRecord\n  scope :active, -> { where("name = #{params[:name]}") }\nend\n'
      );

      const result = runEditHook(runtime.railsSgHook, project, filePath);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("ast-grep found issues");
      expect(result.stderr).toContain("no-raw-sql-in-where");
    }
  );

  it.each(HOOK_RUNTIMES)(
    "$name Rails RuboCop hook blocks and returns lint feedback",
    runtime => {
      const project = createRailsProject();
      const filePath = writeProjectFile(
        project,
        "app/models/user.rb",
        "class User < ApplicationRecord\nend\n"
      );
      writeFakeBundler(project);

      const result = runEditHook(runtime.railsRuboCopHook, project, filePath);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("RuboCop found unfixable errors");
      expect(result.stderr).toContain("Style/VerifierProbe");
    }
  );

  it.each(HOOK_RUNTIMES.filter(runtime => runtime.injectRulesHook))(
    "$name eager-rule hook injects context into the runtime envelope",
    runtime => {
      const pluginRoot = createPluginRootWithEagerRule();
      const result = spawnSync(
        BASH,
        [path.join(REPO_ROOT, runtime.injectRulesHook!)],
        {
          encoding: "utf8",
          env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
          input: JSON.stringify({ hook_event_name: "SubagentStart" }),
        }
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const output = JSON.parse(result.stdout) as {
        additionalContext?: string;
        hookSpecificOutput?: {
          hookEventName?: string;
          additionalContext?: string;
        };
      };
      expect(output.additionalContext).toBeUndefined();
      expect(output.hookSpecificOutput?.hookEventName).toBe("SubagentStart");
      expect(output.hookSpecificOutput?.additionalContext).toContain(
        RULE_SENTINEL
      );
    }
  );
});

/**
 * Create a downstream TypeScript-shaped project with Lisa's shipped ast-grep
 * rules and package script installed.
 * @returns Temporary project root.
 */
function createTypeScriptProject(): string {
  const project = createProject("typescript");
  cpSync(
    path.join(REPO_ROOT, "typescript", COPY_OVERWRITE_DIR, AST_GREP_DIR),
    path.join(project, AST_GREP_DIR),
    { recursive: true }
  );
  cpSync(
    path.join(REPO_ROOT, "typescript", COPY_OVERWRITE_DIR, SGCONFIG_FILENAME),
    path.join(project, SGCONFIG_FILENAME)
  );
  writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ scripts: { "sg:scan": `${AST_GREP} scan` } }, null, 2)
  );
  writeFileSync(path.join(project, "bun.lock"), "\n");
  return project;
}

/**
 * Create a downstream Rails-shaped project with Lisa's shipped ast-grep rules.
 * @returns Temporary project root.
 */
function createRailsProject(): string {
  const project = createProject("rails");
  cpSync(
    path.join(REPO_ROOT, "rails", COPY_OVERWRITE_DIR, AST_GREP_DIR),
    path.join(project, AST_GREP_DIR),
    { recursive: true }
  );
  cpSync(
    path.join(REPO_ROOT, "rails", COPY_OVERWRITE_DIR, SGCONFIG_FILENAME),
    path.join(project, SGCONFIG_FILENAME)
  );
  writeFileSync(
    path.join(project, "Gemfile"),
    "source 'https://rubygems.org'\n"
  );
  writeFakeSg(project);
  return project;
}

/**
 * Create and track a temporary downstream project directory.
 * @param stack - Stack name used in the temporary directory prefix.
 * @returns Temporary project root.
 */
function createProject(stack: string): string {
  const project = mkdtempSync(path.join(tmpdir(), `lisa-${stack}-gates-`));
  tempDirs.push(project);
  return project;
}

/**
 * Create a temporary plugin root containing one eager rule.
 * @returns Temporary plugin root.
 */
function createPluginRootWithEagerRule(): string {
  const pluginRoot = createProject("eager-rule");
  const rulesDir = path.join(pluginRoot, "rules", "eager");
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(path.join(rulesDir, "verifier.md"), `${RULE_SENTINEL}\n`);
  return pluginRoot;
}

/**
 * Write a source file into the temporary project.
 * @param project - Temporary project root.
 * @param relativePath - Project-relative file path.
 * @param source - File contents to write.
 * @returns Absolute path to the written file.
 */
function writeProjectFile(
  project: string,
  relativePath: string,
  source: string
): string {
  const filePath = path.join(project, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);
  return filePath;
}

/**
 * Execute a Lisa edit hook with Claude-style PostToolUse JSON input.
 * @param hookPath - Repository-relative hook path.
 * @param project - Temporary downstream project root.
 * @param filePath - Absolute path passed as the edited file.
 * @returns Hook process result.
 */
function runEditHook(
  hookPath: string,
  project: string,
  filePath: string
): HookResult {
  return spawnSync(BASH, [path.join(REPO_ROOT, hookPath)], {
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: project,
      PATH: `${path.join(project, "bin")}:${process.env.PATH ?? ""}`,
    },
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
  });
}

/**
 * Install a local `sg` shim that delegates to the repository ast-grep binary.
 * @param project - Temporary downstream project root.
 */
function writeFakeSg(project: string): void {
  writeProjectBin(project, "sg", `exec "${AST_GREP}" "$@"\n`);
}

/**
 * Install a local `bundle` shim that emits a deterministic RuboCop diagnostic.
 * @param project - Temporary downstream project root.
 */
function writeFakeBundler(project: string): void {
  const logBody = [
    'printf "Style/VerifierProbe: planted RuboCop finding\\n" >&2',
    "exit 1",
  ].join("\n");

  writeProjectBin(project, "bundle", logBody);
}

/**
 * Write an executable helper binary into the temporary project's PATH.
 * @param project - Temporary downstream project root.
 * @param name - Binary name.
 * @param body - Shell body after the shebang.
 */
function writeProjectBin(project: string, name: string, body: string): void {
  const binDir = path.join(project, "bin");
  const binPath = path.join(binDir, name);

  mkdirSync(binDir, { recursive: true });
  writeFileSync(binPath, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(binPath, 0o755);
}
