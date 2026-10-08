/** Official Sentry activation is a host preference; other guards stay managed. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MergeStrategy,
  mergeTemplateJson,
} from "../../../src/strategies/merge.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";

const SENTRY = "sentry@claude-plugins-official";
const SAFETY_NET = "safety-net@cc-marketplace";
const SOURCE = { enabledPlugins: { [SENTRY]: false, [SAFETY_NET]: false } };

describe("official Sentry host preference", () => {
  it.each([true, false])(
    "preserves an explicit boolean %s across repeated merges",
    chosen => {
      const host = { enabledPlugins: { [SENTRY]: chosen, [SAFETY_NET]: true } };
      const merged = mergeTemplateJson(SOURCE, host);
      expect(merged).toEqual({
        enabledPlugins: { [SENTRY]: chosen, [SAFETY_NET]: false },
      });
      expect(mergeTemplateJson(SOURCE, merged)).toEqual(merged);
      expect(
        mergeTemplateJson({ enabledPlugins: { [SENTRY]: !chosen } }, host)
      ).toEqual({ enabledPlugins: { [SENTRY]: chosen, [SAFETY_NET]: true } });
      expect(host.enabledPlugins[SENTRY]).toBe(chosen);
      expect(SOURCE.enabledPlugins[SENTRY]).toBe(false);
    }
  );

  it.each([undefined, "true", 1, null])(
    "retains the disabled default for absent or invalid choice %s",
    chosen => {
      const merged = mergeTemplateJson(SOURCE, {
        enabledPlugins: { [SENTRY]: chosen },
      });
      expect(merged).toEqual(SOURCE);
    }
  );

  it("preserves activation through the actual filesystem apply twice", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lisa-sentry-preference-"));
    try {
      const source = path.join(root, "source.json");
      const destination = path.join(root, "settings.json");
      await writeFile(source, JSON.stringify(SOURCE));
      await writeFile(
        destination,
        JSON.stringify({ enabledPlugins: { [SENTRY]: true } })
      );
      const context: StrategyContext = {
        backupFile: async () => {},
        config: {
          destDir: root,
          dryRun: false,
          harness: "claude",
          lisaDir: root,
          skipGitCheck: false,
          validateOnly: false,
          yesMode: true,
        },
        promptOverwrite: async () => true,
      };
      const strategy = new MergeStrategy();
      await strategy.apply(
        source,
        destination,
        ".claude/settings.json",
        context
      );
      const first = await readFile(destination, "utf8");
      await strategy.apply(
        source,
        destination,
        ".claude/settings.json",
        context
      );
      expect(await readFile(destination, "utf8")).toBe(first);
      expect(JSON.parse(first).enabledPlugins[SENTRY]).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
