import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { createMigrationRegistry } from "../../../src/migrations/index.js";
import type {
  Migration,
  MigrationContext,
} from "../../../src/migrations/migration.interface.js";
import { MergeStrategy } from "../../../src/strategies/merge.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SETTINGS_PATH = ".claude/settings.json";
const MIGRATION_NAME = "prune-retired-entire-hooks";
const VERBS = [
  "post-task",
  "post-todo",
  "pre-task",
  "session-end",
  "session-start",
  "stop",
  "user-prompt-submit",
];
const HOST_COMMAND =
  'bash "$CLAUDE_PROJECT_DIR/scripts/private-session-hooks.sh" session-start';

/**
 * Build a historically shipped registration without invoking Entire.
 * @param verb - Historical event verb
 * @returns Exact retired command hook
 */
function retiredHook(verb: string): Record<string, string> {
  return {
    type: "command",
    command: `command -v entire >/dev/null 2>&1 && entire hooks claude-code ${verb} || true`,
  };
}

/**
 * Seed every retired command alongside unrelated and explicitly opted-in hooks.
 * @returns Synthetic host-owned settings
 */
function seededSettings(): Record<string, unknown> {
  return {
    env: { HOST_VALUE: "preserve" },
    permissions: { allow: ["Read(/public/**)"] },
    hooks: {
      SessionStart: [
        {
          matcher: "startup",
          hostMetadata: "keep",
          hooks: [
            { type: "command", command: HOST_COMMAND },
            ...VERBS.map(retiredHook),
            { type: "command", command: "echo host" },
          ],
        },
        { matcher: "empty", hooks: [] },
        { matcher: "all-retired", hooks: [retiredHook("stop")] },
        {
          matcher: "near-match",
          hooks: [
            {
              type: "command",
              command: `${retiredHook("stop").command} # host`,
            },
          ],
        },
        {
          matcher: "prompt",
          hooks: [{ ...retiredHook("stop"), type: "prompt" }],
        },
        { matcher: "unshaped", hooks: "host-value" },
        null,
      ],
      HostEvent: "untouched",
    },
  };
}

/**
 * Expected surgical projection, independently specified rather than production-filtered.
 * @returns Surviving host hook values and order
 */
function expectedHooks(): Record<string, unknown> {
  return {
    SessionStart: [
      {
        matcher: "startup",
        hostMetadata: "keep",
        hooks: [
          { type: "command", command: HOST_COMMAND },
          { type: "command", command: "echo host" },
        ],
      },
      { matcher: "empty", hooks: [] },
      {
        matcher: "near-match",
        hooks: [
          { type: "command", command: `${retiredHook("stop").command} # host` },
        ],
      },
      {
        matcher: "prompt",
        hooks: [{ ...retiredHook("stop"), type: "prompt" }],
      },
      { matcher: "unshaped", hooks: "host-value" },
      null,
    ],
    HostEvent: "untouched",
  };
}

describe("Entire privacy defaults", () => {
  it.each([
    "rails/merge/.claude/settings.json",
    "plugins/src/base/.claude-plugin/plugin.json",
  ])("registers no Entire hook in %s", async source => {
    const json = await fs.readJson(path.join(REPO_ROOT, source));
    expect(JSON.stringify(json.hooks ?? {})).not.toContain(
      "entire hooks claude-code"
    );
  });

  it("preserves base-plugin governance registrations", async () => {
    const json = await fs.readJson(
      path.join(REPO_ROOT, "plugins/src/base/.claude-plugin/plugin.json")
    );
    const text = JSON.stringify(json.hooks);
    expect(text).toContain("enforce-verification-gate.sh");
    expect(text).toContain("worktree-binding-guard.sh");
    expect(text).toContain("block-no-verify.sh");
  });
});

describe("PruneRetiredEntireHooksMigration", () => {
  let tempDir: string;
  let projectDir: string;
  let target: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    target = path.join(projectDir, SETTINGS_PATH);
    await fs.ensureDir(path.dirname(target));
    await fs.copy(
      path.join(REPO_ROOT, "rails/create-only/.github/workflows/ci.yml"),
      path.join(projectDir, ".github/workflows/ci.yml")
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build the original migration contract.
   * @param dryRun - Whether mutation is disabled
   * @returns Synthetic local context
   */
  function context(dryRun = false): MigrationContext {
    return {
      projectDir,
      lisaDir: REPO_ROOT,
      detectedTypes: ["rails"],
      dryRun,
      logger: new SilentLogger(),
    };
  }

  /**
   * Resolve through the actual registry; absence is an assertion failure on old source.
   * @returns Registered pruner
   */
  function migration(): Migration {
    const entry = createMigrationRegistry()
      .getAll()
      .find(item => item.name === MIGRATION_NAME);
    expect(entry, "registered post-strategy privacy migration").toBeDefined();
    if (!entry) throw new Error("Missing privacy migration");
    return entry;
  }

  /**
   * Canonical JSON fixture serialization.
   * @param value - JSON fixture
   * @returns Text including final newline
   */
  function jsonText(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
  }

  /**
   * Drive the actual Rails merge route followed by the default migration registry.
   * @returns Applied completion
   */
  async function mergeAndMigrate(): Promise<void> {
    const strategyContext: StrategyContext = {
      config: {
        lisaDir: REPO_ROOT,
        destDir: projectDir,
        dryRun: false,
        yesMode: true,
        validateOnly: false,
        skipGitCheck: false,
        harness: "claude",
      },
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };
    await new MergeStrategy().apply(
      path.join(REPO_ROOT, "rails/merge", SETTINGS_PATH),
      target,
      SETTINGS_PATH,
      strategyContext
    );
    await createMigrationRegistry().runAll(context());
  }

  it("retires all seven commands through real merge and registry, preserving opt-in after repeat apply", async () => {
    await fs.writeFile(target, jsonText(seededSettings()));
    await mergeAndMigrate();
    expect((await fs.readJson(target)).hooks).toEqual(expectedHooks());
    const first = await fs.readFile(target, "utf-8");
    await mergeAndMigrate();
    expect(await fs.readFile(target, "utf-8")).toBe(first);
  });

  it("changes only retired command entries and newly empty groups", async () => {
    const input = seededSettings();
    await fs.writeFile(target, jsonText(input));
    const result = await migration().apply(context());
    expect(await fs.readFile(target, "utf-8")).toBe(
      jsonText({ ...input, hooks: expectedHooks() })
    );
    expect(result.action).toBe("applied");
    expect(result.changedFiles).toEqual([
      path.join(".claude", "settings.json"),
    ]);
    expect(await migration().applies(context())).toBe(false);
    expect((await migration().apply(context())).action).toBe("noop");
  });

  it("writes nothing during dry-run", async () => {
    const text = jsonText(seededSettings());
    await fs.writeFile(target, text);
    expect((await migration().apply(context(true))).action).toBe("applied");
    expect(await fs.readFile(target, "utf-8")).toBe(text);
  });

  it("silently leaves missing settings absent", async () => {
    const ctx = context();
    const warn = vi.spyOn(ctx.logger, "warn");
    expect(await migration().applies(ctx)).toBe(false);
    expect((await migration().apply(ctx)).action).toBe("noop");
    expect(await fs.pathExists(target)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns and preserves malformed JSON byte-for-byte", async () => {
    const text = '{ "hooks": {';
    await fs.writeFile(target, text);
    const ctx = context();
    const warn = vi.spyOn(ctx.logger, "warn");
    expect(await migration().applies(ctx)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(SETTINGS_PATH));
    expect((await migration().apply(ctx)).action).toBe("noop");
    expect(await fs.readFile(target, "utf-8")).toBe(text);
  });

  it.each([
    {},
    { hooks: [] },
    { hooks: "host" },
    { hooks: { Stop: null } },
    { hooks: { Stop: [{ hooks: [null, "host", {}] }] } },
  ])(
    "preserves settings without exact retired command hooks: %j",
    async input => {
      const text = jsonText(input);
      await fs.writeFile(target, text);
      expect(await migration().applies(context())).toBe(false);
      expect((await migration().apply(context())).action).toBe("noop");
      expect(await fs.readFile(target, "utf-8")).toBe(text);
    }
  );
});
