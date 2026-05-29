/**
 * Shared fixtures + helpers for the Cursor plugin-artifact generator tests
 * (issue #1055). Split out of the test files to keep each under the max-lines
 * lint cap and to keep one source of truth for the fixture scaffold + the `.mdc`
 * frontmatter parser used by both the behavior suite and the committed-artifact
 * regression suite.
 * @module tests/unit/scripts/cursor-artifact-helpers
 */
import * as fs from "fs-extra";
import * as path from "node:path";

export const PLUGIN_JSON = "plugin.json";
export const CLAUDE_PLUGIN_DIR = ".claude-plugin";
export const HOOKS_JSON = "hooks.json";
export const MCP_JSON = "mcp.json";
export const DOT_MCP_JSON = ".mcp.json";
export const BLOCK_NO_VERIFY = "block-no-verify.sh";
export const INJECT_RULES = "inject-rules.sh";
export const ENFORCE_TEAM_FIRST = "enforce-team-first.sh";
export const INSTALL_PKGS = "install-pkgs.sh";
export const SETUP_JIRA = "setup-jira-cli.sh";

const ROOT = "${CLAUDE_PLUGIN_ROOT}/hooks/";

// Eager + reference rule basenames for the fixture. Deliberately OVERLAPPING
// (base-rules, coding-philosophy appear in both) to mirror the real base plugin,
// where all 13 names collide — a naive flatten to rules/<name>.mdc would drop half.
export const EAGER_RULES = [
  "base-rules",
  "coding-philosophy",
  "verification",
] as const;
export const REFERENCE_RULES = ["base-rules", "coding-philosophy"] as const;

const scriptEntry = (matcher: string, ...scripts: readonly string[]) => ({
  matcher,
  hooks: scripts.map(s => ({ type: "command", command: `${ROOT}${s}` })),
});

const entireEntry = (verb: string) => ({
  matcher: "",
  hooks: [
    {
      type: "command",
      command: `command -v entire >/dev/null 2>&1 && entire hooks claude-code ${verb} || true`,
    },
  ],
});

// Claude-format base manifest hook block: a universal PreToolUse gate, a
// SessionStart trio (install-pkgs + inject-rules + setup-jira-cli), plus
// Claude-only entries (entire call, enforce-team-first) that must be stripped.
export const BASE_HOOK_BLOCK = {
  UserPromptSubmit: [
    entireEntry("user-prompt-submit"),
    scriptEntry("", ENFORCE_TEAM_FIRST),
  ],
  PreToolUse: [scriptEntry("Bash", BLOCK_NO_VERIFY)],
  SessionStart: [
    scriptEntry("startup", INSTALL_PKGS),
    scriptEntry("", INJECT_RULES),
    scriptEntry("", SETUP_JIRA),
  ],
};

/**
 * YAML frontmatter parse for a Cursor `.mdc` rule file.
 * @param filePath Absolute path to the `.mdc` file.
 * @returns Whether frontmatter exists, the `alwaysApply` value, and whether a description is present.
 */
export function readMdcFrontmatter(filePath: string): {
  readonly hasFrontmatter: boolean;
  readonly alwaysApply: boolean | undefined;
  readonly hasDescription: boolean;
} {
  const raw = fs.readFileSync(filePath, "utf8");
  const match = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!match) {
    return {
      hasFrontmatter: false,
      alwaysApply: undefined,
      hasDescription: false,
    };
  }
  const body = match[1];
  const alwaysApplyMatch = /^alwaysApply:\s*(true|false)\s*$/m.exec(body);
  return {
    hasFrontmatter: true,
    alwaysApply: alwaysApplyMatch ? alwaysApplyMatch[1] === "true" : undefined,
    hasDescription: /^description:\s*\S/m.test(body),
  };
}

/**
 * Recursively collect every file path under dir (relative to dir).
 * @param dir Absolute directory to walk.
 * @returns Relative file paths beneath dir (empty when dir is absent).
 */
export function walkFiles(dir: string): readonly string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(entry =>
      entry.isDirectory()
        ? walkFiles(path.join(dir, entry.name)).map(rel =>
            path.join(entry.name, rel)
          )
        : [entry.name]
    );
}

/**
 * Scaffold a built-Claude-plugin fixture under srcDir.
 * @param srcDir Absolute source plugin dir to populate.
 * @param opts Options.
 * @param opts.hooks Manifest hook block (omit/`{}` to simulate a stack variant).
 * @param opts.withMcp Whether to write a `.mcp.json`.
 * @returns Promise resolved once the fixture is written.
 */
export async function scaffoldSource(
  srcDir: string,
  opts: { readonly hooks?: object; readonly withMcp?: boolean }
): Promise<void> {
  await fs.ensureDir(path.join(srcDir, CLAUDE_PLUGIN_DIR));
  await fs.writeJson(path.join(srcDir, CLAUDE_PLUGIN_DIR, PLUGIN_JSON), {
    name: "lisa-test",
    version: "0.0.0",
    hooks: opts.hooks ?? {},
  });

  // hooks/ scripts the manifest references.
  await fs.ensureDir(path.join(srcDir, "hooks"));
  for (const script of [
    BLOCK_NO_VERIFY,
    INJECT_RULES,
    ENFORCE_TEAM_FIRST,
    INSTALL_PKGS,
    SETUP_JIRA,
  ]) {
    await fs.writeFile(
      path.join(srcDir, "hooks", script),
      "#!/usr/bin/env bash\nexit 0\n",
      { encoding: "utf8", mode: 0o755 }
    );
  }

  // Nested rule tree (the current/buggy source layout). Eager and reference
  // share basenames but carry DIFFERENT bodies, so both copies must survive.
  await fs.ensureDir(path.join(srcDir, "rules", "eager"));
  for (const name of EAGER_RULES) {
    await fs.writeFile(
      path.join(srcDir, "rules", "eager", `${name}.md`),
      `# ${name} (eager)\n\nEager rule body for ${name}.\n`,
      "utf8"
    );
  }
  await fs.ensureDir(path.join(srcDir, "rules", "reference"));
  for (const name of REFERENCE_RULES) {
    await fs.writeFile(
      path.join(srcDir, "rules", "reference", `${name}.md`),
      `# ${name} (reference)\n\nReference rule body for ${name}.\n`,
      "utf8"
    );
  }

  // A skill (passthrough sanity).
  await fs.ensureDir(path.join(srcDir, "skills", "lisa-demo"));
  await fs.writeFile(
    path.join(srcDir, "skills", "lisa-demo", "SKILL.md"),
    "# demo skill\n",
    "utf8"
  );

  if (opts.withMcp) {
    await fs.writeJson(path.join(srcDir, DOT_MCP_JSON), {
      mcpServers: { expo: { type: "http", url: "https://mcp.expo.dev/mcp" } },
    });
  }
}
