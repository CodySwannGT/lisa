/**
 * Runtime contract tests for OpenCode's managed-file adapter
 * (CodySwannGT/lisa#3750).
 *
 * OpenCode had no managed-file protection at all. The guard had no OpenCode
 * template and no fallback-dispatcher installer, so both of Lisa's delivery
 * channels missed it, while the same project was protected on Claude, Cursor,
 * Copilot and Codex. Under the pre-fix emit there is no plugin at all, so every
 * case here fails on a missing module.
 *
 * The adapter shells out to the canonical `block-managed-file-edits.sh` — the
 * same script every other surface runs — so these cases are about the ADAPTER
 * being wired and translating correctly, not about classification. Exit 2 is
 * the guard's policy refusal; any other non-zero status is an environment
 * failure the adapter must report as itself rather than as a refusal of the
 * requested command.
 *
 * THE TEMP DIRECTORY IS A SYNTHETIC HOST PROJECT, and that is load-bearing.
 * The canonical guard stands down inside Lisa's own repository, where these
 * files ARE the originals, so a run rooted at the repo reports allow for
 * everything — and would pass identically against an adapter that does nothing.
 * The staged layout matches `installHooks`: adapter and canonical script side
 * by side, since the adapter resolves the script through `import.meta.dir`.
 * @module tests/unit/opencode/block-managed-file-edits-plugin
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

useIoLatencyBudget();

const TEMPLATE_DIR = path.join(
  process.cwd(),
  "src",
  "opencode",
  "plugin-templates"
);
const HOOK_DIR = path.join(process.cwd(), "plugins", "src", "base", "hooks");
const PLUGIN_FILENAME = "lisa-block-managed-file-edits.ts";
const SCRIPT_FILENAME = "block-managed-file-edits.sh";
const BUN_PATH = boundedSpawnSync({
  label: "which bun",
  command: "/usr/bin/which",
  args: ["bun"],
}).stdout.trim();

/** A copy-overwrite template, host-relative. */
const MANAGED = "scripts/lisa-hooks/block-no-verify.sh";
/** A path the host owns outright. */
const UNMANAGED = "src/app.ts";

describe("OpenCode block-managed-file-edits plugin", () => {
  let tempDir: string;
  let pluginPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    pluginPath = path.join(tempDir, PLUGIN_FILENAME);
    await fs.copy(path.join(TEMPLATE_DIR, PLUGIN_FILENAME), pluginPath);
    await fs.copy(
      path.join(HOOK_DIR, SCRIPT_FILENAME),
      path.join(tempDir, SCRIPT_FILENAME)
    );

    // The host project the guard needs before it will classify anything: a
    // package.json that is NOT @codyswann/lisa, plus an installed package
    // carrying the copy-overwrite tree the candidate path is resolved against.
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "a-host-project", version: "1.0.0" }),
      "utf-8"
    );
    const shipped = path.join(
      tempDir,
      "node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-hooks"
    );
    await fs.ensureDir(shipped);
    await fs.writeFile(
      path.join(shipped, "block-no-verify.sh"),
      "shipped\n",
      "utf-8"
    );
    await fs.ensureDir(path.join(tempDir, "scripts/lisa-hooks"));
    await fs.writeFile(path.join(tempDir, MANAGED), "local\n", "utf-8");
    await fs.ensureDir(path.join(tempDir, "src"));
    await fs.writeFile(path.join(tempDir, UNMANAGED), "app\n", "utf-8");
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
      const plugin = await imported.LisaBlockManagedFileEdits();
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
      label: "bun invoking the block-managed-file-edits plugin",
      command: BUN_PATH,
      args: ["-e", program],
      baseMs: 30_000,
      cwd: tempDir,
      env: {
        ...process.env,
        PLUGIN_PATH: pluginPath,
        TEST_COMMAND: command,
        LISA_ALLOW_MANAGED_FILE_WRITE: "",
      },
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };

  it.each([
    ["a redirect", `echo tampered > ${MANAGED}`],
    ["an append", `echo more >> ${MANAGED}`],
    ["a tee", `echo tampered | tee ${MANAGED}`],
  ])("refuses %s into a managed template", (_label, command) => {
    expect(invoke(command)).toContain("deny:");
  });

  it("surfaces the canonical guard's own reason", () => {
    // The adapter shells out and nothing more, so the operator must see the
    // canonical refusal — the file, and the way out — not a generic message.
    const outcome = invoke(`echo tampered > ${MANAGED}`);
    expect(outcome).toContain(MANAGED);
    expect(outcome).toContain("LISA_ALLOW_MANAGED_FILE_WRITE=1");
  });

  // ── Rejection controls ────────────────────────────────────────────────────
  // A plugin that throws unconditionally satisfies every case above. These
  // separate a working adapter from one that has simply stopped working.
  describe("rejection controls", () => {
    it.each([
      ["cat", `cat ${MANAGED}`],
      ["grep", `grep -n shipped ${MANAGED}`],
      ["wc", `wc -l ${MANAGED}`],
    ])("allows %s, which only reads a managed template", (_label, command) => {
      expect(invoke(command)).toBe("allow");
    });

    it("allows a write to a file the host owns", () => {
      expect(invoke(`echo edited > ${UNMANAGED}`)).toBe("allow");
    });

    it("allows a non-bash tool call", () => {
      const program = `
        const imported = await import(${JSON.stringify("file://PLACEHOLDER")}.replace("PLACEHOLDER", process.env.PLUGIN_PATH));
        const plugin = await imported.LisaBlockManagedFileEdits();
        const outcome = await plugin["tool.execute.before"](
          { tool: "read" },
          { args: { command: process.env.TEST_COMMAND } }
        );
        console.log(outcome === undefined ? "allow" : "unexpected");
      `;
      const result = boundedSpawnSync({
        label: "bun invoking the plugin for a non-bash tool",
        command: BUN_PATH,
        args: ["-e", program],
        baseMs: 30_000,
        cwd: tempDir,
        env: {
          ...process.env,
          PLUGIN_PATH: pluginPath,
          TEST_COMMAND: `echo tampered > ${MANAGED}`,
        },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("allow");
    });
  });

  it("delegates rather than reimplementing classification", () => {
    // The property the ticket asks for. `lisa-block-direct-issue-create.ts` is
    // the counter-example in this same directory — a full reimplementation that
    // documents its own deliberate divergences — and it is what this adapter is
    // deliberately not.
    const source = fs.readFileSync(
      path.join(TEMPLATE_DIR, PLUGIN_FILENAME),
      "utf-8"
    );
    expect(source).toContain(SCRIPT_FILENAME);
    expect(source).toContain("Bun.spawn");
    expect(source).not.toContain("copy-overwrite/");
  });
});
