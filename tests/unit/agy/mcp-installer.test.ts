/**
 * Unit tests for src/agy/mcp-installer.ts.
 *
 * Covers the pure transform `translateMcpEntryToAgy` and the tagged-merge
 * behavior of `installAgyMcpConfig` against a tmp-file target.
 * @module tests/unit/agy/mcp-installer
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultProjectMcpConfigPath,
  defaultUserMcpConfigPath,
  installAgyMcpConfig,
  LISA_MANAGED_MARKER,
  resolveAgyMcpConfigPath,
  translateMcpEntryToAgy,
} from "../../../src/agy/mcp-installer.js";

const MCP_SERVERS_KEY = "mcpServers";
const NODE_CMD = "node";
const MCP_CONFIG_FILENAME = "mcp_config.json";

describe("agy/mcp-installer", () => {
  describe("resolveAgyMcpConfigPath", () => {
    // Pure path-resolution tests — nothing is written, so use a non-tmp
    // absolute root to keep the publicly-writable-directories rule satisfied.
    const PROJ = path.join(path.sep, "srv", "lisa-proj");

    it("defaults to project scope for lisa apply", () => {
      const out = resolveAgyMcpConfigPath({ destDir: PROJ });
      expect(out).toBe(defaultProjectMcpConfigPath(PROJ));
    });

    it("resolves user scope to the shared ~/.gemini config", () => {
      expect(resolveAgyMcpConfigPath({ scope: "user" })).toBe(
        defaultUserMcpConfigPath()
      );
    });

    it("resolves explicit project scope with destDir", () => {
      const out = resolveAgyMcpConfigPath({
        scope: "project",
        destDir: PROJ,
      });
      expect(out).toBe(defaultProjectMcpConfigPath(PROJ));
    });

    it("throws when project scope is requested without a destDir", () => {
      expect(() => resolveAgyMcpConfigPath({ scope: "project" })).toThrow(
        /project scope requires a destDir/
      );
    });
  });

  describe("translateMcpEntryToAgy", () => {
    it("passes stdio entries through unchanged", () => {
      const out = translateMcpEntryToAgy({
        command: NODE_CMD,
        args: ["server.js"],
        env: { KEY: "value" },
      });
      expect(out).toEqual({
        command: NODE_CMD,
        args: ["server.js"],
        env: { KEY: "value" },
      });
    });

    it("omits args when absent from input", () => {
      const out = translateMcpEntryToAgy({ command: NODE_CMD });
      expect(out).toEqual({ command: NODE_CMD });
      expect("args" in out).toBe(false);
    });

    it("renames url to serverUrl for HTTP transport", () => {
      const out = translateMcpEntryToAgy({
        type: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer abc" },
      });
      expect(out).toEqual({
        serverUrl: "https://example.com/mcp",
        headers: { Authorization: "Bearer abc" },
      });
      expect("url" in out).toBe(false);
      expect("type" in out).toBe(false);
    });

    it("omits headers when absent on HTTP entry", () => {
      const out = translateMcpEntryToAgy({
        type: "http",
        url: "https://example.com",
      });
      expect(out).toEqual({ serverUrl: "https://example.com" });
      expect("headers" in out).toBe(false);
    });

    it("returns empty object for unknown shapes", () => {
      const out = translateMcpEntryToAgy({});
      expect(out).toEqual({});
    });
  });

  describe("installAgyMcpConfig (tmp file target)", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agy-mcp-test-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { force: true, recursive: true });
    });

    it("writes Lisa entries with the _lisaManaged marker", async () => {
      const targetPath = path.join(tempDir, MCP_CONFIG_FILENAME);
      const result = await installAgyMcpConfig(
        {
          weather: { command: NODE_CMD, args: ["weather.js"] },
        },
        targetPath
      );

      expect(result.path).toBe(targetPath);
      expect(result.lisaEntryCount).toBe(1);
      expect(result.hostEntryCount).toBe(0);

      const written = JSON.parse(
        await fs.readFile(targetPath, "utf8")
      ) as Record<string, unknown>;
      const servers = written[MCP_SERVERS_KEY] as Record<string, unknown>;
      expect(servers).toHaveProperty("weather");
      const weather = servers["weather"] as Record<string, unknown>;
      expect(weather[LISA_MANAGED_MARKER]).toBe(true);
      expect(weather["command"]).toBe("node");
    });

    it("preserves host entries that lack the marker", async () => {
      const targetPath = path.join(tempDir, MCP_CONFIG_FILENAME);
      // Pre-existing host config with one entry.
      await fs.writeFile(
        targetPath,
        JSON.stringify({
          mcpServers: {
            hostThing: { command: "python", args: ["thing.py"] },
          },
        }),
        "utf8"
      );

      const result = await installAgyMcpConfig(
        {
          weather: { command: NODE_CMD },
        },
        targetPath
      );

      expect(result.lisaEntryCount).toBe(1);
      expect(result.hostEntryCount).toBe(1);

      const written = JSON.parse(
        await fs.readFile(targetPath, "utf8")
      ) as Record<string, unknown>;
      const servers = written[MCP_SERVERS_KEY] as Record<string, unknown>;
      expect(servers).toHaveProperty("hostThing");
      expect(servers).toHaveProperty("weather");
      const hostThing = servers["hostThing"] as Record<string, unknown>;
      expect(LISA_MANAGED_MARKER in hostThing).toBe(false);
    });

    it("replaces Lisa-managed entries on re-run", async () => {
      const targetPath = path.join(tempDir, MCP_CONFIG_FILENAME);

      await installAgyMcpConfig(
        { svc: { command: NODE_CMD, args: ["old.js"] } },
        targetPath
      );
      await installAgyMcpConfig(
        { svc: { command: NODE_CMD, args: ["new.js"] } },
        targetPath
      );

      const written = JSON.parse(
        await fs.readFile(targetPath, "utf8")
      ) as Record<string, unknown>;
      const servers = written[MCP_SERVERS_KEY] as Record<string, unknown>;
      const svc = servers["svc"] as Record<string, unknown>;
      expect(svc["args"]).toEqual(["new.js"]);
    });

    it("removes stale _lisaManaged entries when called with an empty map", async () => {
      const targetPath = path.join(tempDir, MCP_CONFIG_FILENAME);
      // Pre-existing config with a Lisa-managed entry and a host entry.
      await fs.writeFile(
        targetPath,
        JSON.stringify({
          mcpServers: {
            hostServer: { command: "python", args: ["host.py"] },
            staleServer: {
              serverUrl: "https://old.example.com/mcp",
              [LISA_MANAGED_MARKER]: true,
            },
          },
        }),
        "utf8"
      );

      // Calling with an empty map should remove the stale managed entry.
      const result = await installAgyMcpConfig({}, targetPath);

      expect(result.lisaEntryCount).toBe(0);
      expect(result.hostEntryCount).toBe(1);

      const written = JSON.parse(
        await fs.readFile(targetPath, "utf8")
      ) as Record<string, unknown>;
      const servers = written[MCP_SERVERS_KEY] as Record<string, unknown>;
      expect(Object.keys(servers)).not.toContain("staleServer");
      expect(Object.keys(servers)).toContain("hostServer");
    });
  });
});
