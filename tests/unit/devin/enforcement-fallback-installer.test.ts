/**
 * Tests for the Devin repository enforcement fallback (CodySwannGT/lisa#4427).
 *
 * The fallback is the only enforcement a Devin session has when the Lisa
 * plugin is not installed: Devin ignores the Claude-matcher hooks in
 * `.claude/settings.json` because its tools are `exec` / `write` / `edit`.
 * @module tests/unit/devin/enforcement-fallback-installer
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEVIN_FALLBACK_COMMAND,
  DEVIN_FALLBACK_MATCHER,
  installDevinEnforcementFallback,
  mergeDevinFallback,
} from "../../../src/devin/enforcement-fallback-installer.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const HOOKS_FILE = path.join(".devin", "hooks.v1.json");
const HOST_COMMAND = "./host-hook.sh";

/** One matcher group as written to `.devin/hooks.v1.json`. */
interface Group {
  readonly matcher?: string;
  readonly hooks: readonly { readonly command: string }[];
}

const readHooks = async (dir: string): Promise<Record<string, Group[]>> =>
  (await fs.readJson(path.join(dir, HOOKS_FILE))) as Record<string, Group[]>;

const lisaHandlerCount = (groups: readonly Group[] | undefined): number =>
  (groups ?? [])
    .flatMap(group => group.hooks)
    .filter(handler => handler.command === DEVIN_FALLBACK_COMMAND).length;

describe("installDevinEnforcementFallback", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "devin-fallback-"));
  });

  afterEach(async () => {
    await fs.remove(dir);
  });

  it("creates .devin/hooks.v1.json with one PreToolUse handler on Devin tool names", async () => {
    const result = await installDevinEnforcementFallback(dir);

    const hooks = await readHooks(dir);
    expect(result.managedFiles).toEqual([HOOKS_FILE]);
    expect(hooks.PreToolUse?.[0]?.matcher).toBe(DEVIN_FALLBACK_MATCHER);
    expect(lisaHandlerCount(hooks.PreToolUse)).toBe(1);
  });

  it("keeps host hooks and stays at one Lisa handler across re-applies", async () => {
    await fs.outputJson(path.join(dir, HOOKS_FILE), {
      PreToolUse: [{ matcher: "exec", hooks: [{ command: HOST_COMMAND }] }],
      Stop: [{ hooks: [{ command: "./host-stop.sh" }] }],
    });

    await installDevinEnforcementFallback(dir);
    await installDevinEnforcementFallback(dir);

    const hooks = await readHooks(dir);
    expect(hooks.PreToolUse?.[0]?.hooks[0]?.command).toBe(HOST_COMMAND);
    expect(hooks.Stop?.[0]?.hooks[0]?.command).toBe("./host-stop.sh");
    expect(lisaHandlerCount(hooks.PreToolUse)).toBe(1);
  });

  it("refuses to overwrite a hooks file that is not a JSON object", async () => {
    await fs.outputFile(path.join(dir, HOOKS_FILE), "[]");
    await expect(installDevinEnforcementFallback(dir)).rejects.toThrow(
      /refusing to overwrite/
    );
    expect(await fs.readFile(path.join(dir, HOOKS_FILE), "utf8")).toBe("[]");
  });
});

describe("mergeDevinFallback", () => {
  it("removes a stale Lisa handler sharing a group with a host handler", () => {
    const merged = mergeDevinFallback({
      PreToolUse: [
        {
          matcher: "exec",
          hooks: [
            { command: HOST_COMMAND },
            { command: "old scripts/lisa-enforcement-fallback.sh" },
          ],
        },
      ],
    });
    const groups = merged.PreToolUse as readonly Group[];
    expect(groups[0]?.hooks).toEqual([{ command: HOST_COMMAND }]);
    expect(lisaHandlerCount(groups)).toBe(1);
  });
});

describe("DEVIN_FALLBACK_COMMAND", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "devin-fallback-cmd-"));
    await fs.outputFile(
      path.join(dir, "scripts", "lisa-enforcement-fallback.sh"),
      "#!/bin/bash\njq -r .tool_name\nexit 2\n",
      { mode: 0o755 }
    );
  });

  afterEach(async () => {
    await fs.remove(dir);
  });

  const runCommand = (toolName: string) =>
    boundedSpawnSync({
      label: `devin fallback command (${toolName})`,
      command: "/bin/sh",
      args: ["-c", DEVIN_FALLBACK_COMMAND],
      env: { ...process.env, DEVIN_PROJECT_DIR: dir },
      input: JSON.stringify({
        tool_name: toolName,
        tool_input: { command: "ls" },
      }),
    });

  it("hands the dispatcher the Claude tool name and returns its block status", () => {
    const result = runCommand("exec");
    expect(result.stdout.trim()).toBe("Bash");
    expect(result.status).toBe(2);
  });

  it("maps the file-edit tools and leaves apply_patch for the guards that read it", () => {
    expect(runCommand("write").stdout.trim()).toBe("Write");
    expect(runCommand("edit").stdout.trim()).toBe("Edit");
    expect(runCommand("apply_patch").stdout.trim()).toBe("apply_patch");
  });
});
