/**
 * Unit tests for src/opencode/mcp-installer.ts.
 *
 * Covers the pure `translateMcpEntryToOpencode` transform (stdio → local,
 * http → remote), the `mergeMcpServers` tagged-merge (fresh file, host
 * preservation, stale-Lisa stripping), and the `installOpencodeMcpConfig`
 * I/O wrapper against a tmp-file target.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISA_MANAGED_MARKER,
  installOpencodeMcpConfig,
  mergeMcpServers,
  resolveOpencodeConfigPath,
  translateMcpEntryToOpencode,
} from "../../../src/opencode/mcp-installer.js";
import { CONFIG_FILENAME } from "../../../src/opencode/settings-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const SENTRY_HTTP = {
  type: "http" as const,
  url: "https://mcp.sentry.dev/mcp",
};

describe("opencode/mcp-installer", () => {
  describe("translateMcpEntryToOpencode", () => {
    it("translates a stdio entry to a local server with an argv array", () => {
      const out = translateMcpEntryToOpencode({
        command: "node",
        args: ["server.js", "--flag"],
        env: { API_KEY: "x" },
      });
      expect(out).toEqual({
        type: "local",
        command: ["node", "server.js", "--flag"],
        environment: { API_KEY: "x" },
        enabled: true,
      });
    });

    it("omits environment when no env is provided", () => {
      const out = translateMcpEntryToOpencode({ command: "mcp-bin" });
      expect(out).toEqual({
        type: "local",
        command: ["mcp-bin"],
        enabled: true,
      });
    });

    it("translates an http entry to a remote server with url", () => {
      const out = translateMcpEntryToOpencode({
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer t" },
      });
      expect(out).toEqual({
        type: "remote",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer t" },
        enabled: true,
      });
    });

    it("throws on an entry with neither command nor url", () => {
      expect(() => translateMcpEntryToOpencode({})).toThrow(
        /neither `command`/u
      );
    });
  });

  describe("mergeMcpServers", () => {
    it("creates a fresh document for empty input", () => {
      const { text, lisaEntryCount, hostEntryCount } = mergeMcpServers("", {
        sentry: SENTRY_HTTP,
      });
      const parsed = parseJsonc(text) as Record<string, unknown>;
      const mcp = parsed["mcp"] as Record<string, Record<string, unknown>>;
      expect(mcp["sentry"]?.["type"]).toBe("remote");
      expect(mcp["sentry"]?.[LISA_MANAGED_MARKER]).toBe(true);
      expect(lisaEntryCount).toBe(1);
      expect(hostEntryCount).toBe(0);
    });

    it("preserves host-authored MCP servers and sibling keys", () => {
      const host = `{
  "$schema": "https://opencode.ai/config.json",
  "share": "disabled",
  "mcp": {
    "host-tool": { "type": "local", "command": ["host-bin"], "enabled": true }
  }
}`;
      const { text, hostEntryCount } = mergeMcpServers(host, {
        sentry: SENTRY_HTTP,
      });
      const parsed = parseJsonc(text) as Record<string, unknown>;
      const mcp = parsed["mcp"] as Record<string, Record<string, unknown>>;
      expect(mcp["host-tool"]?.["command"]).toEqual(["host-bin"]);
      expect(mcp["host-tool"]?.[LISA_MANAGED_MARKER]).toBeUndefined();
      expect(mcp["sentry"]?.["type"]).toBe("remote");
      // Sibling keys untouched.
      expect(parsed["share"]).toBe("disabled");
      expect(hostEntryCount).toBe(1);
    });

    it("strips stale Lisa-managed entries on re-run (idempotent ownership)", () => {
      const prior = mergeMcpServers("", { sentry: SENTRY_HTTP }).text;
      // Re-run with NO Lisa servers: the prior Lisa entry must be removed.
      const { text, lisaEntryCount, hostEntryCount } = mergeMcpServers(
        prior,
        {}
      );
      const parsed = parseJsonc(text) as Record<string, unknown>;
      const mcp = parsed["mcp"] as Record<string, unknown>;
      expect(mcp["sentry"]).toBeUndefined();
      expect(lisaEntryCount).toBe(0);
      expect(hostEntryCount).toBe(0);
    });

    it("replaces a prior Lisa entry without duplicating it", () => {
      const prior = mergeMcpServers("", { sentry: SENTRY_HTTP }).text;
      const { text, lisaEntryCount } = mergeMcpServers(prior, {
        sentry: SENTRY_HTTP,
      });
      const parsed = parseJsonc(text) as Record<string, unknown>;
      const mcp = parsed["mcp"] as Record<string, unknown>;
      expect(Object.keys(mcp)).toEqual(["sentry"]);
      expect(lisaEntryCount).toBe(1);
    });

    it("throws on malformed host JSON", () => {
      expect(() => mergeMcpServers(`{ "mcp": }`, {})).toThrow(
        /not valid JSONC/u
      );
    });
  });

  describe("installOpencodeMcpConfig", () => {
    let destDir: string;

    beforeEach(async () => {
      destDir = await createTempDir();
    });

    afterEach(async () => {
      await cleanupTempDir(destDir);
    });

    it("writes Lisa MCP servers into opencode.json", async () => {
      const configPath = resolveOpencodeConfigPath(destDir);
      const result = await installOpencodeMcpConfig(
        { sentry: SENTRY_HTTP },
        configPath
      );
      expect(result.lisaEntryCount).toBe(1);
      expect(result.path).toBe(path.join(destDir, CONFIG_FILENAME));
      const parsed = parseJsonc(
        await fs.readFile(configPath, "utf8")
      ) as Record<string, unknown>;
      const mcp = parsed["mcp"] as Record<string, Record<string, unknown>>;
      expect(mcp["sentry"]?.["url"]).toBe("https://mcp.sentry.dev/mcp");
    });

    it("merges into an existing settings file without losing keys", async () => {
      const configPath = resolveOpencodeConfigPath(destDir);
      await fs.writeFile(
        configPath,
        `{ "$schema": "https://opencode.ai/config.json", "share": "disabled" }`,
        "utf8"
      );
      await installOpencodeMcpConfig({ sentry: SENTRY_HTTP }, configPath);
      const parsed = parseJsonc(
        await fs.readFile(configPath, "utf8")
      ) as Record<string, unknown>;
      expect(parsed["share"]).toBe("disabled");
      expect(
        (parsed["mcp"] as Record<string, unknown>)["sentry"]
      ).toBeDefined();
    });
  });
});
