/**
 * Real distributed channels must agree on bytes, including ownership banners.
 * @module tests/unit/hooks/guard-dedupe-generated-channels
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installHooks } from "../../../src/opencode/hooks-installer.js";

import {
  DISPATCHER,
  PLUGIN,
  HARMLESS,
  cleanupWorlds,
  drainEvaluations,
  installChannel,
  makeWorld,
  nextToolCall,
  run,
} from "./support/guard-dedupe-world.js";

const HOST_HOOKS = "all/copy-overwrite/scripts/lisa-hooks";
const PLUGIN_HOOKS = "plugins/lisa/hooks";
const MEMO_LIBRARY = "guard-dedupe.bash";
const SHARED_FILES = [
  "block-no-verify.sh",
  "parity-safety-net.sh",
  "block-shell-json-parsing.sh",
  "block-instruction-file-edits.sh",
  "block-direct-issue-create.sh",
  "block-managed-file-edits.sh",
  "block-blind-automerge.sh",
  "worktree-binding-guard.sh",
  "worktree-binding-guard.mjs",
  "parity-safety-net-heredoc.py",
  MEMO_LIBRARY,
];

afterEach(cleanupWorlds);

describe("generated guard channels", () => {
  it.each(SHARED_FILES)("ships byte-identical %s to both channels", file => {
    expect(readFileSync(path.join(HOST_HOOKS, file))).toEqual(
      readFileSync(path.join(PLUGIN_HOOKS, file))
    );
  });

  it.each(["plugin", "opencode"])(
    "evaluates the distributed guard once across dispatcher and %s",
    async adapter => {
      const world = makeWorld();
      const dispatcher = installChannel(world, DISPATCHER);
      const plugin = installChannel(world, PLUGIN);
      const consumer = world.root;
      if (adapter === "opencode")
        await installHooks(process.cwd(), consumer, [], []);
      const pluginSource =
        adapter === "opencode"
          ? path.join(consumer, ".opencode/plugin")
          : PLUGIN_HOOKS;
      const invocation = 'lisa_guard_dedupe block-no-verify "$input"';
      for (const [channel, source] of [
        [dispatcher, HOST_HOOKS],
        [plugin, pluginSource],
      ] as const) {
        const guard = readFileSync(
          path.join(source, "block-no-verify.sh"),
          "utf-8"
        );
        expect(guard).toContain(invocation);
        // Identical instrumentation in each generated copy observes actual body
        // execution while preserving any banner difference between the channels.
        writeFileSync(
          channel.script,
          guard.replace(
            invocation,
            `${invocation}\nprintf '%s\\n' "$LISA_PROBE_CHANNEL" >> "$LISA_PROBE_LOG"`
          )
        );
        copyFileSync(
          path.join(source, MEMO_LIBRARY),
          path.join(path.dirname(channel.script), MEMO_LIBRARY)
        );
      }
      run(world, dispatcher, HARMLESS);
      run(world, plugin, HARMLESS);
      nextToolCall(world);
      drainEvaluations(world);
      expect(run(world, dispatcher, HARMLESS)).toBe(0);
      expect(run(world, plugin, HARMLESS)).toBe(0);
      expect(drainEvaluations(world)).toEqual([DISPATCHER]);
    }
  );
});
