/**
 * Runtime contract tests for OpenCode's block-no-verify adapter
 * (CodySwannGT/lisa#3078).
 *
 * ## What was wrong
 *
 * OpenCode was the one agent in the fleet with no semantic `--no-verify` guard.
 * Its emit carried `permission.bash` deny globs — `"*--no-verify*"` and two
 * `git commit -n` prefixes — and a glob list matches how a bypass was TYPED,
 * not what git will do with it. `git commit --no-veri` is an unambiguous
 * abbreviation git resolves to `--no-verify`, and it matched nothing; so did a
 * cluster reaching `-n` later on the line. Adding `*--no-veri*` would have
 * closed one spelling and left the class open, because which abbreviations git
 * accepts is a property of git's parser, not of Lisa's list.
 *
 * ## What the cases pin
 *
 * The adapter runs the canonical `block-no-verify.sh` — the same tokenizing
 * script Claude, Codex, Cursor and Copilot run — so these cases are about the
 * ADAPTER being wired and translating correctly, and about the class of
 * spellings the globs could not reach. Under the pre-fix emit there was no
 * plugin at all, so every case here fails on a missing module.
 *
 * Each blocked case is paired with a negative control that must still run. The
 * controls are what separate a guard from a refusal to work: `grep -n`,
 * `git push -n`, and a commit whose MESSAGE names the flag are all legitimate,
 * and the last of those is one the glob floor gets wrong and the tokenizer gets
 * right.
 *
 * Command strings are assembled from fragments rather than written literally,
 * so this file does not itself carry a spelling that agent-side guards refuse.
 * @module tests/unit/opencode/block-no-verify-plugin
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

// The bounded children below are handed a base that only fits under a case
// budget scaling with the same machine they do. Without this call the case
// budget is the flat one from `vitest.config.local.ts`, and the child's bound
// overtakes it from a slowdown of 4.0x up — a range measured on this box, in
// this tree, in the run that fixed CodySwannGT/lisa#3202.
useIoLatencyBudget();

const TEMPLATE_DIR = path.join(
  process.cwd(),
  "src",
  "opencode",
  "plugin-templates"
);
const HOOK_DIR = path.join(process.cwd(), "plugins", "src", "base", "hooks");
const PLUGIN_FILENAME = "lisa-block-no-verify.ts";
const SCRIPT_FILENAME = "block-no-verify.sh";
const BUN_PATH = boundedSpawnSync({
  label: "which bun",
  command: "/usr/bin/which",
  args: ["bun"],
}).stdout.trim();

/** The long flag, assembled so this file carries no literal bypass spelling. */
const DASHES = "-".repeat(2);
const LONG_FLAG = `${DASHES}no-verify`;
/** The husky kill switch, likewise assembled. */
const HUSKY_OFF = `${"HUSKY"}=0`;

describe("OpenCode block-no-verify plugin", () => {
  let tempDir: string;
  let pluginPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    pluginPath = path.join(tempDir, PLUGIN_FILENAME);
    // Staged exactly as installHooks stages it: the adapter and the canonical
    // script side by side in `.opencode/plugin/`. The adapter resolves the
    // script through `import.meta.dir`, so a layout that differs here would
    // test a resolution the host never sees.
    await fs.copy(path.join(TEMPLATE_DIR, PLUGIN_FILENAME), pluginPath);
    await fs.copy(
      path.join(HOOK_DIR, SCRIPT_FILENAME),
      path.join(tempDir, SCRIPT_FILENAME)
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Invoke the adapter's before-hook under Bun, as OpenCode would.
   * @param command - The bash command the agent asked to run.
   * @returns "allow" when the hook returns, "deny:<reason>" when it throws.
   */
  const invoke = (command: string): string => {
    const program = `
      const imported = await import(${JSON.stringify("file://PLACEHOLDER")}.replace("PLACEHOLDER", process.env.PLUGIN_PATH));
      const plugin = await imported.LisaBlockNoVerify();
      try {
        await plugin["tool.execute.before"](
          { tool: "bash" },
          { args: { command: process.env.TEST_COMMAND } }
        );
        console.log("allow");
      } catch (error) {
        console.log("deny:" + String(error?.message ?? error));
      }
    `;
    const result = boundedSpawnSync({
      label: "bun invoking the block-no-verify plugin",
      command: BUN_PATH,
      args: ["-e", program],
      baseMs: 30_000,
      cwd: tempDir,
      env: { ...process.env, PLUGIN_PATH: pluginPath, TEST_COMMAND: command },
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };

  it("blocks the long flag", () => {
    expect(invoke(`git commit -m x ${LONG_FLAG}`)).toContain("deny:");
  });

  // THE CASE THE GLOBS COULD NOT REACH. `--no-veri` is an unambiguous prefix of
  // `--no-verify`, so git skips pre-commit exactly as completely, and no glob in
  // the emit matched it. Spelling-based matching cannot close this: the next
  // abbreviation defeats the next glob.
  it("blocks an abbreviation git would accept but no glob matched", () => {
    expect(invoke(`git commit -m x ${DASHES}no-veri`)).toContain("deny:");
  });

  it("blocks the shortest abbreviation the guard accepts as a bypass", () => {
    expect(invoke(`git commit -m x ${DASHES}no-v`)).toContain("deny:");
  });

  it("blocks the bare short form", () => {
    expect(invoke("git commit -n -m x")).toContain("deny:");
  });

  it("blocks the short form bundled into an option cluster", () => {
    expect(invoke('git commit -nm "wip"')).toContain("deny:");
  });

  // The second thing globs could not reach: `-n` arriving after other options.
  // No glob catches it without also refusing `grep -n`.
  it("blocks the short form reached late on the line", () => {
    expect(invoke("git commit -am wip -n")).toContain("deny:");
  });

  it("blocks the husky kill switch", () => {
    expect(invoke(`${HUSKY_OFF} git commit -m x`)).toContain("deny:");
  });

  it("blocks relocating hooks to a directory that holds none", () => {
    expect(invoke("git -c core.hooksPath=/tmp/empty commit -m x")).toContain(
      "deny:"
    );
  });

  it("blocks the env-var spelling of the same config", () => {
    expect(
      invoke(
        "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath " +
          "GIT_CONFIG_VALUE_0=/tmp/empty git commit -m x"
      )
    ).toContain("deny:");
  });

  // NEGATIVE CONTROLS. A guard that refuses these is not precise, it is broken —
  // and `-n` means something ordinary to almost every command that takes it.
  it("allows a line count on an unrelated command", () => {
    expect(invoke("grep -n foo src/app.ts")).toBe("allow");
  });

  it("allows the dry-run spelling of -n on git push", () => {
    expect(invoke("git push -n origin main")).toBe("allow");
  });

  it("allows an ordinary commit", () => {
    expect(invoke('git commit -m "fix: login redirect"')).toBe("allow");
  });

  it("allows a commit followed by a command that takes -n", () => {
    // The boundary case. Without operator-aware tokenizing the whole line reads
    // as one git invocation and the grep is refused.
    expect(invoke("git commit -m x && grep -n foo a.ts")).toBe("allow");
  });

  it("allows a commit whose message merely names the flag", () => {
    // What the tokenizer buys over the glob floor: the flag's text inside a
    // message is a message, not an option. `*--no-verify*` refuses this; the
    // canonical script does not.
    expect(invoke(`git commit -m "docs: explain ${LONG_FLAG}"`)).toBe("allow");
  });

  it("allows relocating hooks to the project's own husky directory", () => {
    expect(invoke("git -c core.hooksPath=.husky commit -m x")).toBe("allow");
  });

  it("ignores tools other than bash", () => {
    const program = `
      const imported = await import(${JSON.stringify("file://PLACEHOLDER")}.replace("PLACEHOLDER", process.env.PLUGIN_PATH));
      const plugin = await imported.LisaBlockNoVerify();
      await plugin["tool.execute.before"](
        { tool: "edit" },
        { args: { command: process.env.TEST_COMMAND } }
      );
      console.log("allow");
    `;
    const result = boundedSpawnSync({
      label: "bun invoking the block-no-verify plugin for a non-bash tool",
      command: BUN_PATH,
      args: ["-e", program],
      baseMs: 30_000,
      cwd: tempDir,
      env: {
        ...process.env,
        PLUGIN_PATH: pluginPath,
        TEST_COMMAND: `git commit ${LONG_FLAG}`,
      },
    });
    expect(result.stdout.trim()).toBe("allow");
  });
});
