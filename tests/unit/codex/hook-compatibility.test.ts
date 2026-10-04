/** Loaded commands survive retirement without re-registering legacy handlers. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installHookCompatibility,
  installHooks,
} from "../../../src/codex/hooks-installer.js";
import { retireProjectHooks } from "../../../src/codex/project-hooks-cleanup.js";
import { installCodexEnforcementFallback } from "../../../src/codex/enforcement-fallback-installer.js";
import { writeManagedManifest } from "../../../src/codex/manifest.js";
import { checkLegacyCodexOverlay } from "../../../src/cli/doctor-legacy-overlay.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const HOOKS_CONFIG = ".codex/hooks.json";
const GUARD_FILE = "block-no-verify.sh";
const INJECT_FILE = "inject-rules.sh";
const HOST_CUSTOM_SCRIPT =
  "#!/bin/sh\n# Lisa-managed Codex hook script\nprintf HOST_CUSTOM_MARKER\n";
const ROOT = process.cwd();
const HOOK_DIR = path.join(".codex", "hooks", "lisa");
const OLD_COMMAND =
  'bash "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/lisa/block-no-verify.sh"';

describe("Codex active hook compatibility", () => {
  let host: string;
  beforeEach(async () => {
    host = await createTempDir();
  });
  afterEach(async () => cleanupTempDir(host));

  it("copies every installed command and its closure despite changed detection, preserving host siblings", async () => {
    const previous = await installHooks(ROOT, host, [
      "typescript",
      "rails",
      "nestjs",
      "harper-fabric",
    ]);
    await fs.outputFile(
      path.join(host, HOOK_DIR, "host-check.sh"),
      "host-authored\n"
    );
    await fs.outputFile(
      path.join(host, ".codex/lisa-rules/eager/host.md"),
      "host rule\n"
    );
    const files = await installHookCompatibility(
      ROOT,
      host,
      [],
      previous.managedFiles
    );
    await retireProjectHooks(host, previous.managedFiles);
    await installCodexEnforcementFallback(host);
    for (const file of previous.managedFiles.filter(
      file => file !== "hooks.json"
    )) {
      expect(files).toContain(file);
      expect(
        (await fs.lstat(path.join(host, ".codex", file))).isSymbolicLink()
      ).toBe(false);
    }
    expect(
      await fs.readFile(path.join(host, HOOK_DIR, "host-check.sh"), "utf8")
    ).toBe("host-authored\n");
    expect(
      await fs.readFile(
        path.join(host, ".codex/lisa-rules/eager/host.md"),
        "utf8"
      )
    ).toBe("host rule\n");
    expect(files).not.toContain("lisa-rules/eager/host.md");
    const hooks = await fs.readJson(path.join(host, HOOKS_CONFIG));
    expect(Object.keys(hooks.hooks)).toEqual(["PreToolUse"]);
    expect(hooks.hooks.PreToolUse[0].hooks[0]._lisaId).toBe(
      "enforcement-fallback"
    );
    await writeManagedManifest(host, [...files, "hooks.json"], files);
    expect(checkLegacyCodexOverlay(host).status).toBe("ok");
    expect(await installHookCompatibility(ROOT, host, [], files)).toEqual(
      files
    );
    await fs.remove(path.join(host, HOOK_DIR, INJECT_FILE));
    expect(checkLegacyCodexOverlay(host).status).toBe("warn");
  });

  it("reconciles dangling catalog links without a manifest and leaves unowned catalog-name files alone", async () => {
    const filename = "rubocop-on-edit.sh";
    const destination = path.join(host, HOOK_DIR, filename);
    await fs.ensureDir(path.dirname(destination));
    await fs.symlink(
      path.join(
        host,
        "node_modules/@codyswann/lisa/dist/codex/scripts",
        filename
      ),
      destination
    );
    await fs.outputFile(
      path.join(host, HOOK_DIR, GUARD_FILE),
      HOST_CUSTOM_SCRIPT
    );
    const files = await installHookCompatibility(ROOT, host, [], []);
    expect(files).toContain(path.join("hooks/lisa", filename));
    expect(files).toContain("hooks/lisa/lisa-edit-gate.sh");
    expect((await fs.lstat(destination)).isFile()).toBe(true);
    expect(
      await fs.readFile(path.join(host, HOOK_DIR, GUARD_FILE), "utf8")
    ).toBe(HOST_CUSTOM_SCRIPT);
  });

  it("preserves an untagged host command even when its custom file retains a Lisa header", async () => {
    const script = path.join(host, HOOK_DIR, GUARD_FILE);
    await fs.outputFile(script, HOST_CUSTOM_SCRIPT);
    await fs.outputJson(path.join(host, HOOKS_CONFIG), {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: OLD_COMMAND }],
          },
        ],
      },
    });
    const before = boundedSpawnSync({
      command: "bash",
      args: ["-c", OLD_COMMAND],
      cwd: host,
      input: "{}",
      label: "host command before",
    });
    expect(await installHookCompatibility(ROOT, host, [], [])).toEqual([]);
    await retireProjectHooks(host, []);
    await installCodexEnforcementFallback(host);
    const after = boundedSpawnSync({
      command: "bash",
      args: ["-c", OLD_COMMAND],
      cwd: host,
      input: "{}",
      label: "host command after",
    });
    expect(before.status).toBe(0);
    expect(after.status).toBe(0);
    expect(after.stdout).toBe("HOST_CUSTOM_MARKER");
    expect(after.stdout).toBe(before.stdout);
    const hooks = await fs.readJson(path.join(host, HOOKS_CONFIG));
    expect(hooks.hooks.PreToolUse[0].hooks[0].command).toBe(OLD_COMMAND);
  });

  it.each(["host-owned", "node_modules/@codyswann/lisa"])(
    "preserves a functional host symlink in %s with a catalog-shaped target",
    async sourceRoot => {
      const target = path.join(
        host,
        sourceRoot,
        "dist/codex/scripts",
        GUARD_FILE
      );
      const script = path.join(host, HOOK_DIR, GUARD_FILE);
      await fs.outputFile(target, HOST_CUSTOM_SCRIPT);
      await fs.outputJson(path.join(host, sourceRoot, "package.json"), {
        name: "anonymous-host-hooks",
      });
      await fs.ensureDir(path.dirname(script));
      await fs.symlink(target, script);
      expect(await installHookCompatibility(ROOT, host, [], [])).toEqual([]);
      const result = boundedSpawnSync({
        command: "bash",
        args: ["-c", OLD_COMMAND],
        cwd: host,
        input: "{}",
        label: "preserved host catalog-shaped link",
      });
      expect(await fs.readlink(script)).toBe(target);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("HOST_CUSTOM_MARKER");
    }
  );

  it("preserves host rule symlinks with a Lisa-shaped target during rule injection", async () => {
    const script = path.join(host, HOOK_DIR, INJECT_FILE);
    const target = path.join(
      host,
      "host-owned/plugins/lisa/rules/eager/base-rules.md"
    );
    const rule = path.join(host, ".codex/lisa-rules/eager/base-rules.md");
    await fs.outputFile(target, "HOST_RULE_MARKER\n");
    await fs.ensureDir(path.dirname(script));
    await fs.symlink(path.join(ROOT, "src/codex/scripts", INJECT_FILE), script);
    await fs.ensureDir(path.dirname(rule));
    await fs.symlink(target, rule);
    await installHookCompatibility(ROOT, host, [], []);
    const result = boundedSpawnSync({
      command: "bash",
      args: [script],
      cwd: host,
      input: "{}",
      label: "preserved host rule injection",
    });
    expect(await fs.readlink(rule)).toBe(target);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("HOST_RULE_MARKER");
  });

  it.each(["regular", "symlink"])(
    "rejects an unknown host %s helper collision before changing source-owned entrypoints",
    async representation => {
      const script = path.join(host, HOOK_DIR, "rubocop-on-edit.sh");
      const source = path.join(ROOT, "src/codex/scripts/rubocop-on-edit.sh");
      await fs.ensureDir(path.dirname(script));
      await fs.symlink(source, script);
      const helper = path.join(host, HOOK_DIR, "_extract-edit-paths.sh");
      const target =
        representation === "symlink"
          ? path.join(host, "host-owned/codex/scripts/_extract-edit-paths.sh")
          : helper;
      await fs.outputFile(target, "#!/bin/sh\nprintf HOST_HELPER_MARKER\n");
      if (representation === "symlink") await fs.symlink(target, helper);
      await expect(
        installHookCompatibility(ROOT, host, [], [])
      ).rejects.toThrow("contains host-owned content");
      expect(await fs.readlink(script)).toBe(source);
      expect(
        await fs.pathExists(path.join(host, HOOK_DIR, "lisa-edit-gate.sh"))
      ).toBe(false);
      const result = boundedSpawnSync({
        command: "bash",
        args: [helper],
        cwd: host,
        input: "{}",
        label: "preserved host helper",
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("HOST_HELPER_MARKER");
    }
  );

  it("keeps the exact saved guard executable and rejecting, and rule injection functional", async () => {
    const previous = await installHooks(ROOT, host, []);
    const files = await installHookCompatibility(
      ROOT,
      host,
      [],
      previous.managedFiles
    );
    await retireProjectHooks(host, previous.managedFiles);
    const result = boundedSpawnSync({
      command: "bash",
      args: ["-c", OLD_COMMAND],
      label: "saved guard",
      cwd: host,
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "git commit --no-verify -m forbidden" },
      }),
    });
    expect(result.status).toBe(0);
    expect(
      JSON.parse(result.stdout).hookSpecificOutput.permissionDecision
    ).toBe("deny");
    const injection = boundedSpawnSync({
      command: "bash",
      args: [path.join(host, HOOK_DIR, INJECT_FILE)],
      label: "saved SessionStart",
      cwd: host,
      input: "{}",
    });
    expect(injection.status).toBe(0);
    expect(
      JSON.parse(injection.stdout).hookSpecificOutput.additionalContext.length
    ).toBeGreaterThan(0);
    expect(files).toContain("hooks/lisa/inject-rules.sh");
  });

  it("does not install compatibility scripts into a fresh host", async () => {
    expect(await installHookCompatibility(ROOT, host, ["rails"], [])).toEqual(
      []
    );
    expect(await fs.pathExists(path.join(host, HOOK_DIR))).toBe(false);
  });
});
